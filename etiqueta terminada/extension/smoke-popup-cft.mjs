import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import WebSocket from "ws";

const chrome =
  process.env.MAPLE_CFT_CHROME ||
  join(
    process.env.TEMP || tmpdir(),
    "maple-chrome-for-testing",
    "chrome",
    "win64-151.0.7922.71",
    "chrome-win64",
    "chrome.exe",
  );
if (!existsSync(chrome)) throw new Error(`Chrome for Testing missing: ${chrome}`);

const src = join(process.cwd(), "etiqueta terminada", "extension", "dist-desktop");
const extensionPath = join(process.env.TEMP || tmpdir(), "maple-local-extension-cft");
rmSync(extensionPath, { recursive: true, force: true });
cpSync(src, extensionPath, { recursive: true });

const userData = join(tmpdir(), `maple-cft-${Date.now()}`);
mkdirSync(userData, { recursive: true });

const chromeProc = spawn(
  chrome,
  [
    `--user-data-dir=${userData}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--remote-debugging-port=9335",
    "about:blank",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitDebugger() {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch("http://127.0.0.1:9335/json/version")).ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error("debugger not ready");
}

async function cdp(wsUrl, method, params = {}) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  let id = 0;
  const send = (m, p = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      const on = (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.id !== mid) return;
        ws.off("message", on);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      };
      ws.on("message", on);
      ws.send(JSON.stringify({ id: mid, method: m, params: p }));
    });
  try {
    await send("Runtime.enable");
    const result = await send(method, params);
    ws.close();
    return result;
  } catch (error) {
    try {
      ws.close();
    } catch {}
    throw error;
  }
}

try {
  await waitDebugger();
  await sleep(3000);
  let targets = await (await fetch("http://127.0.0.1:9335/json")).json();
  console.log("targets", targets.map((t) => ({ type: t.type, url: t.url })));

  const sw = targets.find((t) =>
    /chrome-extension:\/\/[a-p]{32}\/background\/service-worker\.js/.test(String(t.url || "")),
  );
  if (!sw) throw new Error("service worker target missing");
  const extensionId = sw.url.match(/^chrome-extension:\/\/([a-p]{32})\//)[1];
  console.log("extensionId", extensionId);

  // Collect SW console / exceptions if possible
  try {
    const ws = new WebSocket(sw.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const logs = [];
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.method === "Runtime.consoleAPICalled") {
        logs.push({
          type: msg.params.type,
          text: (msg.params.args || []).map((a) => a.value ?? a.description).join(" "),
        });
      }
      if (msg.method === "Runtime.exceptionThrown") {
        logs.push({
          type: "exception",
          text: msg.params.exceptionDetails?.text || msg.params.exceptionDetails?.exception?.description,
        });
      }
    });
    ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
    await sleep(1500);
    console.log("sw_logs", logs);
    ws.close();
  } catch (error) {
    console.log("sw_log_error", String(error));
  }

  await fetch(
    "http://127.0.0.1:9335/json/new?" +
      encodeURIComponent(`chrome-extension://${extensionId}/popup/index.html`),
    { method: "PUT" },
  );
  await sleep(2500);
  targets = await (await fetch("http://127.0.0.1:9335/json")).json();
  const page = targets.find((t) => String(t.url || "").includes("/popup/index.html"));
  if (!page) throw new Error("popup page missing");

  const pageLogs = [];
  {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    let mid = 1;
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.method === "Runtime.consoleAPICalled") {
        pageLogs.push({
          type: msg.params.type,
          text: (msg.params.args || []).map((a) => a.value ?? a.description).join(" "),
        });
      }
      if (msg.method === "Runtime.exceptionThrown") {
        pageLogs.push({
          type: "exception",
          text: msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text,
        });
      }
    });
    ws.send(JSON.stringify({ id: mid++, method: "Runtime.enable" }));
    ws.send(JSON.stringify({ id: mid++, method: "Network.enable" }));
    await sleep(2500);
    const evalResult = await new Promise((resolve, reject) => {
      const id = mid++;
      const on = (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.id !== id) return;
        ws.off("message", on);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      };
      ws.on("message", on);
      ws.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: {
            returnByValue: true,
            awaitPromise: true,
            expression: `({
              href: location.href,
              children: document.querySelector('#root')?.childElementCount || 0,
              text: (document.body?.innerText || '').trim().slice(0, 800),
              html: (document.querySelector('#root')?.innerHTML || '').slice(0, 500),
              scripts: [...document.scripts].map(s => s.src)
            })`,
          },
        }),
      );
    });
    console.log("popup_snapshot", JSON.stringify(evalResult.result?.value, null, 2));
    console.log("popup_logs", pageLogs);
    ws.close();
    const value = evalResult.result?.value;
    if (!(value?.children > 0 && value?.text)) {
      process.exitCode = 1;
      console.error("POPUP_STILL_BLANK");
    } else {
      console.log("POPUP_SMOKE_PASS");
    }
  }
} finally {
  try {
    chromeProc.kill();
  } catch {}
  await sleep(500);
  try {
    rmSync(userData, { recursive: true, force: true });
  } catch {}
}
