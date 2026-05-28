// bridge.js — Puente entre los módulos del content script y el background (WS).

(function () {
  function emit(payload) {
    chrome.runtime.sendMessage({ __engine: true, payload });
  }
  window.__engineBridge = { emit };

  // Recibir comandos del backend (vía background)
  chrome.runtime.onMessage.addListener(async (msg, _sender, sendResponse) => {
    if (msg?.type === "SEND_MESSAGE") {
      try {
        const result = await window.__engineSender.sendMessage(msg.data);
        emit({ type: "COMMAND_ACK", commandId: msg.commandId, ok: true, result });
      } catch (e) {
        emit({ type: "COMMAND_ACK", commandId: msg.commandId, ok: false, error: String(e?.message || e) });
      }
      sendResponse({ ok: true });
    }
    return true;
  });

  console.log("[engine.bridge] listo");
})();
