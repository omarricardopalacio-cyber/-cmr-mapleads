// ============================================================
// MAPLE WA ENGINE — Content Script Entry Point
// Inyecta WA-JS + Engine en MAIN world via web_accessible_resources
// ============================================================

import { ContentBridge } from "../bridge/bridge";
import { eventBus } from "../bridge/event-bus";
import { startDomDetector } from "./dom-detector";

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
