// content/bridge/bridge.js — Puente entre el background y el sender.
(function () {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg?.__engine) return;

    if (msg.type === "SEND_MESSAGE") {
      (async () => {
        try {
          const result = await window.__engineSender.sendMessage(msg.payload);
          window.__engineBus.sendToBackend({
            type: "ack",
            commandId: msg.commandId,
            ackStatus: result.sent ? "ok" : "unverified",
            raw: result,
          });
        } catch (e) {
          window.__engineBus.sendToBackend({
            type: "ack",
            commandId: msg.commandId,
            ackStatus: "error",
            raw: { error: String(e?.message || e) },
          });
        }
      })();
      sendResponse({ ok: true });
    } else if (msg.type === "HEALTH_PING") {
      window.__engineObserver?.ensure();
      sendResponse({ ok: true });
    }

    return true;
  });

  console.log("[engine.bridge] listo");
})();
