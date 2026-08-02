import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import WebSocket from "ws";

const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
];
const chrome = chromeCandidates.find((path) => existsSync(path));
if (!chrome) throw new Error("Chrome not found");

const extensionPath =
  process.env.MAPLE_EXT_PATH ||
  join(process.env.TEMP || tmpdir(), "maple-local-extension");
if (!existsSync(join(extensionPath, "manifest.json"))) {
  throw new Error(`Missing ${extensionPath}. Copy dist-desktop there first.`);
}
const userData = join(tmpdir(), `maple-ext-verify-${Date.now()}`);
mkdirSync(userData, { recursive: true });
console.log("loading_extension", extensionPath);

const chromeProc = spawn(
  chrome,
  [
    `--user-data-dir=${userData}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-default-apps",
    "--disable-component-extensions-with-background-pages",
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--remote-debugging-port=9333",
    "about:blank",
  ],
  { stdio: ["ignore", "pipe", "pipe"], detached: false },
);
chromeProc.stderr.on("data", (chunk) => process.stderr.write(chunk));
chromeProc.stdout.on("data", (chunk) => process.stdout.write(chunk));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDebugger() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch("http://127.0.0.1:9333/json/version");
      if (res.ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error("Chrome debugger did not start");
}

function findExtensionId() {
  const candidates = [
    join(userData, "Default", "Preferences"),
    join(userData, "Default", "Secure Preferences"),
  ];
  for (const prefPath of candidates) {
    if (!existsSync(prefPath)) continue;
    const raw = readFileSync(prefPath, "utf8");
    if (raw.includes("dist-desktop") || raw.includes("MAPLE WA Engine (Local)")) {
      const match = raw.match(/"([a-p]{32})"\s*:\s*\{[^}]*"path"\s*:\s*"[^"]*dist-desktop[^"]*"/);
      if (match) return match[1];
      const ids = [...raw.matchAll(/"([a-p]{32})"\s*:\s*\{/g)].map((m) => m[1]);
      if (ids.length) return ids[ids.length - 1];
    }
    try {
      const pref = JSON.parse(raw);
      const settings = pref?.extensions?.settings || {};
      for (const [id, value] of Object.entries(settings)) {
        const path = String(value?.path || "");
        const name = String(value?.manifest?.name || "");
        if (path.includes("dist-desktop") || name.includes("Local")) return id;
      }
    } catch {}
  }
  return null;
}

async function cdpEvaluate(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  let nextId = 0;
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const onMessage = (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.id !== id) return;
        ws.off("message", onMessage);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      };
      ws.on("message", onMessage);
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Runtime.enable");
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  ws.close();
  return result.result?.value;
}

try {
  await waitForDebugger();
  await sleep(3500);
  let targets = await (await fetch("http://127.0.0.1:9333/json")).json();
  console.log("initial_targets", targets.map((t) => ({ type: t.type, url: t.url })));

  const idFromTargets = () => {
    const sw = targets.find((t) =>
      /chrome-extension:\/\/[a-p]{32}\/background\/service-worker\.js/.test(String(t.url || "")),
    );
    return sw?.url?.match(/^chrome-extension:\/\/([a-p]{32})\//)?.[1] || null;
  };

  let extensionId = idFromTargets() || findExtensionId();
  for (let i = 0; !extensionId && i < 20; i++) {
    await sleep(500);
    targets = await (await fetch("http://127.0.0.1:9333/json")).json();
    extensionId = idFromTargets() || findExtensionId();
  }

  // Open extensions page and ask Chrome which unpacked extensions are present.
  if (!extensionId) {
    await fetch("http://127.0.0.1:9333/json/new?" + encodeURIComponent("chrome://extensions/"), { method: "PUT" });
    await sleep(1500);
    targets = await (await fetch("http://127.0.0.1:9333/json")).json();
    const extensionsPage = targets.find((t) => String(t.url || "").startsWith("chrome://extensions"));
    if (extensionsPage?.webSocketDebuggerUrl) {
      const ids = await cdpEvaluate(
        extensionsPage.webSocketDebuggerUrl,
        `(async () => {
          const cards = [...document.querySelectorAll('extensions-item, extensions-manager')];
          return {
            text: document.body?.innerText?.slice(0, 1500) || '',
            href: location.href
          };
        })()`,
      );
      console.log("extensions_page", ids);
      const match = String(ids?.text || "").match(/ID\s*([a-p]{32})/i);
      if (match) extensionId = match[1];
    }
  }

  if (!extensionId) {
    console.error("userData", userData);
    throw new Error("Could not resolve loaded extension id");
  }

  await fetch(`http://127.0.0.1:9333/json/new?${encodeURIComponent(`chrome-extension://${extensionId}/popup/index.html`)}`, {
    method: "PUT",
  });
  await sleep(2000);
  targets = await (await fetch("http://127.0.0.1:9333/json")).json();
  const page = targets.find((t) => String(t.url || "").includes(`/popup/index.html`));
  if (!page?.webSocketDebuggerUrl) {
    console.error("targets", targets.map((t) => t.url));
    throw new Error("Popup target not found");
  }

  // Wait for React to paint.
  let snapshot = null;
  for (let i = 0; i < 15; i++) {
    snapshot = await cdpEvaluate(
      page.webSocketDebuggerUrl,
      `({
        href: location.href,
        childCount: document.querySelector('#root')?.childElementCount || 0,
        text: (document.body?.innerText || '').trim().slice(0, 400),
        scripts: [...document.scripts].map((s) => s.src),
        lastError: window.__maplePopupError || null
      })`,
    );
    if (snapshot?.childCount > 0 || (snapshot?.text && snapshot.text.length > 0)) break;
    await sleep(400);
  }

  console.log(JSON.stringify({ extensionId, snapshot }, null, 2));
  const blank =
    !snapshot?.childCount ||
    !snapshot?.text ||
    /ERR_FILE_NOT_FOUND|No se ha podido acceder/i.test(String(snapshot.text));
  if (blank) throw new Error("Popup remained blank after load");
  console.log("POPUP_SMOKE_PASS");
} finally {
  try {
    chromeProc.kill("SIGTERM");
  } catch {}
  await sleep(800);
  try {
    if (!chromeProc.killed) chromeProc.kill("SIGKILL");
  } catch {}
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch {}
}
