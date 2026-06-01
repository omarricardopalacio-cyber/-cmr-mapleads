// content/core/observer-manager.js — MutationObserver con recovery y dedup TTL.
(function () {
  const TTL_MS = 120_000;
  const SEEN = new Map();
  let observer = null;
  let target = null;
  let lastMutation = Date.now();

  const bus = () => window.__engineBus;
  const sel = () => window.__engineSelectors;
  const parser = () => window.__engineParser;

  function gc() {
    const now = Date.now();
    for (const [k, t] of SEEN) if (now - t > TTL_MS) SEEN.delete(k);
  }

  function emitFromNode(node) {
    const id = node.getAttribute?.("data-id") || node.id;
    if (!id || SEEN.has(id)) return;
    SEEN.set(id, Date.now());

    // Usar versión asíncrona para intentar descargar media real
    (async () => {
      try {
        const parsed = await parser().parseMessageNodeAsync(node);
        if (!parsed || (!parsed.text && !parsed.hasMedia)) return;
        const evtType = parsed.direction === "out" ? "message-out" : "message-in";

        // Construir el campo media con el base64 real (o null si no se pudo)
        let mediaPayload = null;
        if (parsed.hasMedia) {
          if (parsed.mediaPayload?.body) {
            // Tenemos base64 — esto es lo que el backend subirá a Storage
            mediaPayload = {
              body: parsed.mediaPayload.body,
              mimetype: parsed.mediaPayload.mimetype || parsed.mediaPayload.mimeType || "",
              mimeType: parsed.mediaPayload.mimeType || parsed.mediaPayload.mimetype || "",
              size: parsed.mediaPayload.size || 0,
              caption: parsed.mediaPayload.caption || "",
              filename: parsed.mediaPayload.filename || "",
            };
          } else {
            // Sin base64 — enviar metadata para que el backend marque como missing_media
            mediaPayload = {
              body: null,
              mimetype: parsed.mediaPayload?.mimetype || parsed.domMime || "",
              mimeType: parsed.mediaPayload?.mimeType || parsed.domMime || "",
              size: parsed.mediaPayload?.size || 0,
              filehash: parsed.mediaPayload?.filehash || "",
              mediaKey: parsed.mediaPayload?.mediaKey || "",
            };
          }
        }

        const payload = {
          type: evtType,
          chatId: parsed.chatId,
          waMessageId: parsed.id || id,
          direction: parsed.direction,
          text: parsed.text,
          media: mediaPayload,
          sentAt: new Date().toISOString(),
        };
        bus().emit(evtType, payload);
        bus().sendToBackend(payload);
      } catch (e) {
        console.warn("[observer] parse fail", e);
      }
    })();
  }


  function scanAll() {
    const nodes = sel().findAll("messageNode");
    for (const n of nodes) emitFromNode(n);
  }

  function attach() {
    target = sel().findOne("messagesPanel");
    if (!target) return false;
    observer?.disconnect();
    observer = new MutationObserver((muts) => {
      lastMutation = Date.now();
      gc();
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.matches?.(sel().unionSelector("messageNode"))) emitFromNode(node);
          node.querySelectorAll?.(sel().unionSelector("messageNode")).forEach(emitFromNode);
        }
      }
    });
    observer.observe(target, { childList: true, subtree: true });
    console.log("[engine.observer] attached →", target);
    bus().sendToBackend({ type: "status", text: "observer attached", sentAt: new Date().toISOString() });
    scanAll();
    return true;
  }

  function isStale() {
    return Date.now() - lastMutation > 30_000 && !!sel().findOne("appReady");
  }

  function ensure() {
    if (!observer || !target?.isConnected || isStale()) {
      lastMutation = Date.now();
      attach();
    }
  }

  // boot loop
  const boot = setInterval(() => {
    if (sel().findOne("appReady")) {
      clearInterval(boot);
      attach();
      setInterval(ensure, 5000);
    }
  }, 1000);

  window.__engineObserver = { attach, ensure, scanAll };
})();
