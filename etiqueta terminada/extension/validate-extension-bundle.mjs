import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const target = process.argv[2] || "dist-desktop";
const bundle = resolve(root, target);
const errors = [];

function fail(message) {
  errors.push(message);
}

if (!existsSync(bundle)) fail(`Missing bundle directory: ${bundle}`);

const htmlPath = join(bundle, "popup", "index.html");
if (!existsSync(htmlPath)) fail(`Missing ${htmlPath}`);
else {
  const html = readFileSync(htmlPath, "utf8");
  if (html.includes('src="/') || html.includes('href="/')) {
    fail("popup/index.html still has absolute /asset paths (blank popup in Chrome)");
  }
  if (/crossorigin/.test(html)) {
    fail("popup/index.html still has crossorigin attributes (can blank Chrome extension popups)");
  }
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  for (const ref of refs) {
    const absolute = resolve(dirname(htmlPath), ref);
    if (!existsSync(absolute)) fail(`Referenced asset missing: ${ref} -> ${absolute}`);
  }
}

const required = [
  "manifest.json",
  "popup.js",
  "background/service-worker.js",
  "content/index.js",
  "injected/whatsapp-engine.js",
  "vendor/wppconnect-wa.min.js",
];
for (const file of required) {
  if (!existsSync(join(bundle, file))) fail(`Missing required file: ${file}`);
}

const manifest = JSON.parse(readFileSync(join(bundle, "manifest.json"), "utf8"));
if (manifest.action?.default_popup !== "popup/index.html") {
  fail(`Unexpected popup path: ${manifest.action?.default_popup}`);
}
if (manifest.background?.service_worker !== "background/service-worker.js") {
  fail(`Unexpected service worker path: ${manifest.background?.service_worker}`);
}

const sw = readFileSync(join(bundle, "background", "service-worker.js"), "utf8");
const swImports = [...sw.matchAll(/from\s*["']([^"']+)["']/g)].map((m) => m[1]);
for (const ref of swImports) {
  const absolute = resolve(join(bundle, "background"), ref);
  if (!existsSync(absolute)) fail(`Service worker import missing: ${ref}`);
}

if (target === "dist-desktop") {
  const popupJs = readFileSync(join(bundle, "popup.js"), "utf8");
  if (!popupJs.includes("127.0.0.1:4317")) {
    fail("dist-desktop popup.js does not default to local pilot URL");
  }
  if (popupJs.includes("__MAPLE_DESKTOP_PILOT__")) {
    fail("popup.js still references __MAPLE_DESKTOP_PILOT__ (Vite define failed; blank popup)");
  }
  if (!String(manifest.name || "").toLowerCase().includes("local")) {
    fail("dist-desktop manifest name should identify the local pilot build");
  }
}

if (errors.length) {
  console.error(`FAIL ${target}`);
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else files.push(path.slice(bundle.length + 1));
  }
}
walk(bundle);
console.log(`PASS ${target} (${files.length} files)`);
