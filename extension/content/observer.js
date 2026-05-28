// observer.js — Detecta mensajes nuevos en el DOM de WhatsApp Web.
// Estrategia: polling cada 1s + dedupe por id con TTL 120s.
// (MutationObserver suele saturarse en chats grandes; polling es más estable.)

(function () {
  const SEEN = new Map(); // id -> timestamp
  const TTL_MS = 120_000;

  function gc() {
    const now = Date.now();
    for (const [k, t] of SEEN) if (now - t > TTL_MS) SEEN.delete(k);
  }

  function getMessageNodes() {
    // Selector tolerante. Se ajusta si WhatsApp cambia el markup.
    return document.querySelectorAll('div.message-in, div.message-out, div[data-id]');
  }

  function watch() {
    try {
      gc();
      const nodes = getMessageNodes();
      for (const node of nodes) {
        const id = node.getAttribute("data-id") || node.id;
        if (!id || SEEN.has(id)) continue;
        SEEN.set(id, Date.now());
        try {
          const parsed = window.__engineParser?.parseMessageNode(node);
          if (parsed) {
            window.__engineBridge?.emit({
              type: parsed.direction === "out" ? "message-out" : "message-in",
              chatId: parsed.chatId,
              waMessageId: parsed.waMessageId || id,
              direction: parsed.direction,
              text: parsed.text,
              media: parsed.media,
              raw: parsed.raw,
              contact: parsed.contact,
              sentAt: new Date().toISOString(),
            });

          }
        } catch (e) {
          console.warn("[engine.observer] parse fail", e);
        }
      }
    } finally {
      setTimeout(watch, 1000);
    }
  }

  // Esperar que WhatsApp cargue
  const boot = setInterval(() => {
    if (document.querySelector("#app, #main")) {
      clearInterval(boot);
      console.log("[engine.observer] iniciando");
      watch();
    }
  }, 1000);
})();
