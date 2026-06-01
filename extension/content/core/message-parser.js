// content/core/message-parser.js — Nodo DOM → JSON normalizado con descarga real de media.
(function () {
  const sel = () => window.__engineSelectors;

  function getChatId() {
    const header = sel().findOne("chatHeader");
    return header?.getAttribute("data-id") || location.hash || "unknown";
  }

  /**
   * Busca el modelo de mensaje en el Store de WhatsApp por data-id del nodo DOM.
   * El data-id es algo como: "false_5491112223333@c.us_3EB0AF6E7E00A2EB8FBE53"
   */
  function findMsgModelInStore(dataId) {
    try {
      const Store = window.Store;
      if (!Store) return null;

      // Intentar con MsgCollection o Msg store
      const msgStore = Store.Msg || Store.Message || Store.Messages;
      if (msgStore?.get) {
        const m = msgStore.get(dataId);
        if (m) return m;
      }
      if (msgStore?.getModelsArray) {
        const arr = msgStore.getModelsArray();
        const found = arr.find((m) => m?.id?._serialized === dataId || m?.id === dataId);
        if (found) return found;
      }

      // Intentar a través del chat activo
      const chatStore = Store.Chat;
      if (chatStore?.getModelsArray) {
        for (const chat of chatStore.getModelsArray()) {
          const msgs = chat.msgs?.getModelsArray?.() || [];
          for (const msg of msgs) {
            if (msg?.id?._serialized === dataId || msg?.id === dataId) return msg;
          }
        }
      }

      // Búsqueda por el ID final (parte después del último _)
      const parts = String(dataId).split("_");
      const msgKey = parts[parts.length - 1];
      if (msgKey && msgKey.length > 10) {
        const chatActive = chatStore?.getActive?.();
        const msgs = chatActive?.msgs?.getModelsArray?.() || [];
        for (const msg of msgs) {
          const serial = msg?.id?._serialized || "";
          if (serial.endsWith(msgKey)) return msg;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Descarga el media del mensaje usando el Store de WhatsApp.
   * Devuelve { body, mimetype, size, filehash, mediaKey, url } o null.
   */
  async function downloadMediaFromStore(msgModel) {
    if (!msgModel) return null;
    try {
      // El modelo ya tiene el base64 en 'body' si ya fue descargado
      if (msgModel.body && msgModel.body.length > 100) {
        return {
          body: msgModel.body,
          mimetype: msgModel.mimetype || msgModel.mimeType || "",
          mimeType: msgModel.mimetype || msgModel.mimeType || "",
          size: msgModel.size || 0,
          filehash: msgModel.filehash || "",
          mediaKey: msgModel.mediaKey || "",
          url: msgModel.mediaUrl || msgModel.url || null,
          caption: msgModel.caption || "",
          filename: msgModel.filename || "",
        };
      }

      // Intentar descargar si tiene mediaKey (la mayoría de las imágenes recibidas)
      if (msgModel.mediaKey || msgModel.filehash) {
        // Método 1: downloadMedia() disponible en algunas versiones
        if (typeof msgModel.downloadMedia === "function") {
          const result = await msgModel.downloadMedia();
          if (result?.body || result?.data) {
            return {
              body: result.body || result.data,
              mimetype: result.mimetype || msgModel.mimetype || "",
              mimeType: result.mimetype || msgModel.mimetype || "",
              size: msgModel.size || 0,
              filehash: msgModel.filehash || "",
              mediaKey: msgModel.mediaKey || "",
              url: result.url || msgModel.mediaUrl || null,
              caption: msgModel.caption || "",
              filename: msgModel.filename || "",
            };
          }
        }

        // Método 2: usar Store.downloadMedia
        const Store = window.Store;
        const downloadFn = Store?.downloadMedia || Store?.MediaCollection?.downloadMedia;
        if (typeof downloadFn === "function") {
          const result = await downloadFn(msgModel);
          if (result?.body || result?.data) {
            return {
              body: result.body || result.data,
              mimetype: result.mimetype || msgModel.mimetype || "",
              mimeType: result.mimetype || msgModel.mimetype || "",
              size: msgModel.size || 0,
              filehash: msgModel.filehash || "",
              mediaKey: msgModel.mediaKey || "",
              url: result.url || null,
              caption: msgModel.caption || "",
              filename: msgModel.filename || "",
            };
          }
        }

        // Método 3: intentar obtener de blob URL en el DOM
        // Si ya está en pantalla, hay una blob URL en img src
      }

      // Fallback: retornar metadata sin body (se mostrará como "missing_media")
      return {
        body: null,
        mimetype: msgModel.mimetype || msgModel.mimeType || "",
        mimeType: msgModel.mimetype || msgModel.mimeType || "",
        size: msgModel.size || 0,
        filehash: msgModel.filehash || "",
        mediaKey: msgModel.mediaKey || "",
        url: msgModel.mediaUrl || msgModel.url || null,
        caption: msgModel.caption || "",
        filename: msgModel.filename || "",
      };
    } catch (e) {
      console.warn("[parser] downloadMedia error:", e);
      return null;
    }
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

    // 1. Intentar via Store
    const msgModel = findMsgModelInStore(dataId);
    if (msgModel) {
      const mediaData = await downloadMediaFromStore(msgModel);
      if (mediaData) {
        return { ...basic, mediaPayload: mediaData };
      }
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
