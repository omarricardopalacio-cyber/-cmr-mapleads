// content/core/message-parser.js — Nodo DOM → JSON normalizado con descarga real de media.
(function () {
  const sel = () => window.__engineSelectors;

  function getChatId() {
    const header = sel().findOne("chatHeader");
    return header?.getAttribute("data-id") || location.hash || "unknown";
  }

  const REQUEST = "ENGINE_PAGE_REQUEST";
  const RESPONSE = "ENGINE_PAGE_RESPONSE";
  let reqId = 0;
  const pending = new Map();

  // Escuchar respuestas del bridge (MAIN world)
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== RESPONSE || !data.id) return;
    const cb = pending.get(data.id);
    if (cb) {
      pending.delete(data.id);
      cb(data.result);
    }
  });

  function callBridge(action, payload) {
    return new Promise((resolve) => {
      const id = ++reqId;
      pending.set(id, resolve);
      window.postMessage({ type: REQUEST, id, action, ...payload }, "*");
      // Timeout de seguridad
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          resolve(null);
        }
      }, 5000);
    });
  }

  /**
   * Descarga el media del mensaje usando el bridge que corre en MAIN world.
   * Devuelve { body, mimeType, size, caption, filename } o null.
   */
  async function downloadMediaFromStore(dataId) {
    return await callBridge("download_media", { dataId });
  }

  /**
   * Convierte una blob URL del DOM a base64.
   * Útil como último recurso cuando no podemos usar el Store.
   */
  async function blobUrlToBase64(blobUrl) {
    try {
      const resp = await fetch(blobUrl);
      const blob = await resp.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result); // data URI: data:image/jpeg;base64,...
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }

  function getChatId() {
    const header = sel().findOne("chatHeader");
    return header?.getAttribute("data-id") || location.hash || "unknown";
  }

  /**
   * Versión sincrónica para compatibilidad con el observer actual.
   * Devuelve el parsed básico sin media descargada.
   */
  function parseMessageNode(node) {
    const dataId = node.getAttribute("data-id") || node.id || "";
    const dir = window.__engineDetector.direction(node);

    const textEl = sel().findOne("textInNode", node);
    const text = textEl ? textEl.innerText.trim() : "";

    const copyable = sel().findOne("copyableMeta", node);
    const meta = copyable?.getAttribute("data-pre-plain-text") || "";
    const tsMatch = meta.match(/\[(.*?)\]/);

    const hasImage = !!node.querySelector('img[src^="blob:"]');
    const hasAudio = !!node.querySelector("audio");
    const hasVideo = !!node.querySelector("video");
    const hasMedia = hasImage || hasAudio || hasVideo;

    // Detectar tipo de media desde el DOM para saber qué mime usar
    let domMime = "";
    if (hasImage) domMime = "image/jpeg";
    if (hasAudio) domMime = "audio/ogg";
    if (hasVideo) domMime = "video/mp4";

    // Intentar obtener la blob URL del DOM como alternativa
    let blobUrl = null;
    if (hasImage) {
      const img = node.querySelector('img[src^="blob:"]');
      blobUrl = img?.src || null;
    }

    return {
      id: dataId,
      chatId: getChatId(),
      direction: dir,
      text,
      raw_meta: meta,
      timestamp_label: tsMatch ? tsMatch[1] : null,
      hasMedia,
      domMime,
      blobUrl,
      media: hasMedia ? { image: hasImage, audio: hasAudio, video: hasVideo } : null,
    };
  }

  /**
   * Versión asincrónica que intenta descargar el media real.
   * Usada por el observer para mensajes con media.
   */
  async function parseMessageNodeAsync(node) {
    const basic = parseMessageNode(node);

    if (!basic.hasMedia) return { ...basic, mediaPayload: null };

    const dataId = basic.id;

    // 1. Intentar via Bridge (MAIN world tiene acceso al Store)
    const mediaData = await downloadMediaFromStore(dataId);
    if (mediaData && mediaData.body) {
      return { ...basic, mediaPayload: mediaData };
    }

    // 2. Fallback: convertir blob URL del DOM a base64
    if (basic.blobUrl) {
      try {
        const dataUri = await blobUrlToBase64(basic.blobUrl);
        if (dataUri) {
          // dataUri es "data:image/jpeg;base64,/9j/..."
          return {
            ...basic,
            mediaPayload: {
              body: dataUri, // el ingest.ts sabe parsear data URIs
              mimeType: basic.domMime,
              mimetype: basic.domMime,
              caption: "",
            },
          };
        }
      } catch {}
    }

    // 3. No se pudo descargar, enviar metadata sin base64
    return {
      ...basic,
      mediaPayload: {
        body: null,
        mimeType: basic.domMime,
        mimetype: basic.domMime,
        size: 0,
      },
    };
  }

  window.__engineParser = { parseMessageNode, parseMessageNodeAsync };
})();
