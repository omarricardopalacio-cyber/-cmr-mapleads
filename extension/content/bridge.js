// bridge.js — Puente entre los módulos del content script y el background (WS).

(function () {
  function emit(payload) {
    chrome.runtime.sendMessage({ __engine: true, payload });
  }
  window.__engineBridge = { emit };

  // Recibir comandos del backend (vía background)
  // Recibir comandos del backend (vía background)
  chrome.runtime.onMessage.addListener(async (msg, _sender, sendResponse) => {
    if (msg?.__engine && msg?.type === "SEND_MESSAGE") {
      try {
        const result = await window.__engineSender.sendMessage(msg.payload);
        emit({ type: "ack", commandId: msg.commandId, ackStatus: "ok", raw: result });
      } catch (e) {
        emit({ type: "ack", commandId: msg.commandId, ackStatus: "error", raw: { error: String(e?.message || e) } });
      }
      sendResponse({ ok: true });
    }
    return true;
  });


  console.log("[engine.bridge] listo");
})();
