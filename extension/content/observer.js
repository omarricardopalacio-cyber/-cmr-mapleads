// observer.js — Detecta mensajes nuevos en el DOM de WhatsApp Web.

(function () {
  const SEEN = new Map();
  const TTL_MS = 120_000;

  function gc() {
    const now = Date.now();
    for (const [k, t] of SEEN) if (now - t > TTL_MS) SEEN.delete(k);
  }

  function getMessageNodes() {
    // Selectores tolerantes a varias versiones de WhatsApp Web.
    return document.querySelectorAll(
      'div.message-in, div.message-out, ' +
      'div[data-id*="false_"], div[data-id*="true_"], ' +
      '#main div[role="row"] div[data-id]'
    );
  }

  let lastCount = -1;
  function watch() {
    try {
      gc();
      const nodes = getMessageNodes();
      if (nodes.length !== lastCount) {
        lastCount = nodes.length;
        console.log("[engine.observer] nodos detectados:", nodes.length);
        window.__engineBridge?.emit({
          type: "status",
          text: `observer: ${nodes.length} nodos`,
          sentAt: new Date().toISOString(),
        });
      }
      for (const node of nodes) {
        const id = node.getAttribute("data-id") || node.id;
        if (!id || SEEN.has(id)) continue;
        SEEN.set(id, Date.now());
        try {
          const parsed = window.__engineParser?.parseMessageNode(node);
          if (parsed && (parsed.text || parsed.media)) {
            // Inferir dirección desde data-id: "true_..." = saliente, "false_..." = entrante
            let direction = parsed.direction;
            if (id.startsWith("true_")) direction = "out";
            else if (id.startsWith("false_")) direction = "in";
            window.__engineBridge?.emit({
              type: direction === "out" ? "message-out" : "message-in",
              chatId: parsed.chatId,
              waMessageId: parsed.id || id,
              direction,
              text: parsed.text,
              media: parsed.media,
              sentAt: new Date().toISOString(),
            });
          }
        } catch (e) {
          console.warn("[engine.observer] parse fail", e);
        }
      }
    } finally {
      setTimeout(watch, 1500);
    }
  }

  const boot = setInterval(() => {
    if (document.querySelector("#app, #main, div[id='app']")) {
      clearInterval(boot);
      console.log("[engine.observer] iniciando watch");
      window.__engineBridge?.emit({
        type: "status",
        text: "observer iniciado",
        sentAt: new Date().toISOString(),
      });
      watch();
    }
  }, 1000);

  console.log("[engine.observer] script cargado");
})();
