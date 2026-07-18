// ============================================================
// MAPLE WA ENGINE — Content Script Entry Point
// Inyecta WA-JS + Engine en MAIN world via web_accessible_resources
// ============================================================

import { ContentBridge } from "../bridge/bridge";
import { eventBus } from "../bridge/event-bus";
import { startDomDetector } from "./dom-detector";
import "./message-parser"; // Cargar el parser para que esté disponible globalmente

// === PROTOCOLO DE KEEP-ALIVE MV3 ===
const KEEP_ALIVE_PING_MS = 20_000;
const KEEP_ALIVE_RECYCLE_MS = 240_000;
const KEEP_ALIVE_RECONNECT_MS = 5_000;

let keepAlivePort: chrome.runtime.Port | null = null;
let keepAliveIntentionalRecycle = false;
let keepAliveStarted = false;

function connectToServiceWorker(): void {
  try {
    keepAlivePort = chrome.runtime.connect({ name: "maple-keep-alive" });
    console.log("[MAPLE KEEP-ALIVE] Puerto de larga duración conectado con Service Worker.");

    keepAlivePort.onDisconnect.addListener(() => {
      console.warn("[MAPLE KEEP-ALIVE] Puerto desconectado.");
      keepAlivePort = null;

      if (keepAliveIntentionalRecycle) {
        keepAliveIntentionalRecycle = false;
        connectToServiceWorker();
        return;
      }

      setTimeout(connectToServiceWorker, KEEP_ALIVE_RECONNECT_MS);
    });
  } catch (err) {
    console.error("[MAPLE KEEP-ALIVE] Error crítico conectando puerto de persistencia:", err);
    setTimeout(connectToServiceWorker, KEEP_ALIVE_RECONNECT_MS);
  }
}

function startKeepAlive(): void {
  if (keepAliveStarted) return;
  keepAliveStarted = true;

  setInterval(() => {
    if (!keepAlivePort) {
      connectToServiceWorker();
      return;
    }
    try {
      keepAlivePort.postMessage({ type: "PING" });
    } catch {
      console.warn("[MAPLE KEEP-ALIVE] Falló el envío de ping. Intentando reconectar...");
      connectToServiceWorker();
    }
  }, KEEP_ALIVE_PING_MS);

  setInterval(() => {
    if (!keepAlivePort) return;
    console.log("[MAPLE KEEP-ALIVE] Ejecutando reciclaje preventivo del puerto de comunicación.");
    keepAliveIntentionalRecycle = true;
    keepAlivePort.disconnect();
  }, KEEP_ALIVE_RECYCLE_MS);

  connectToServiceWorker();
}

// Inyectar un script <script src="..."> en MAIN world
function injectScript(src: string): HTMLScriptElement {
  const script = document.createElement("script");
  script.src = src;
  script.type = "text/javascript";
  script.onload = () => console.log("[ContentScript] Cargado:", src);
  script.onerror = () => console.error("[ContentScript] Error cargando:", src);
  (document.head || document.documentElement).appendChild(script);
  return script;
}

async function init(): Promise<void> {
  console.log("[ContentScript] Iniciando...");

  startKeepAlive();

  // 1. Bridge content ↔ background
  const bridge = new ContentBridge();
  bridge.init();
  (window as any).__MAPLE_CONTENT_BRIDGE = bridge;

  // 2. DOM detector fallback (siempre activo)
  startDomDetector();
  console.log("[ContentScript] DOM detector iniciado");

  // 3. Inyectar WA-JS local (NO CDN — CSP de WhatsApp lo bloquea)
  const wppUrl = chrome.runtime.getURL("vendor/wppconnect-wa.min.js");
  console.log("[ContentScript] Inyectando WA-JS desde:", wppUrl);
  injectScript(wppUrl);

  // 4. Esperar a que WPP aparezca en MAIN world (engine hace su propio waitForWPP)
  //    Pero damos un head-start de 5s para que WA-JS se cargue
  await new Promise(r => setTimeout(r, 5000));

  // 5. Inyectar el engine
  const engineUrl = chrome.runtime.getURL("injected/whatsapp-engine.js");
  console.log("[ContentScript] Inyectando engine desde:", engineUrl);
  injectScript(engineUrl);

  // 6. Ping para popup
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.source === "MAPLE_WA_POPUP_PING") {
      sendResponse({
        ok: true,
        contentScript: true,
        domDetectorActive: !!(window as any).__MAPLE_DOM_DETECTOR_ACTIVE,
        engineReady: bridge.engineReady,
        url: location.href,
      });
      return false;
    }
    return false;
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
