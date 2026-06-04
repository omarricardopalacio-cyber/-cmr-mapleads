// ============================================================
// MAPLE WA ENGINE — Message Parser (Content Script)
// Extrae media de mensajes de WhatsApp Web usando Store y DOM
// ============================================================

/**
 * Busca el modelo de mensaje en el Store de WhatsApp por data-id del nodo DOM.
 * El data-id es algo como: "false_5491112223333@c.us_3EB0AF6E7E00A2EB8FBE53"
 */
function findMsgModelInStore(dataId: string): any {
  try {
    const Store = (window as any).Store;
    if (!Store) return null;

    // Intentar con MsgCollection o Msg store
    const msgStore = Store.Msg || Store.Message || Store.Messages;
    if (msgStore?.get) {
      const m = msgStore.get(dataId);
      if (m) return m;
    }
    if (msgStore?.getModelsArray) {
      const arr = msgStore.getModelsArray();
      const found = arr.find((m: any) => m?.id?._serialized === dataId || m?.id === dataId);
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
async function downloadMediaFromStore(msgModel: any): Promise<any> {
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
      const Store = (window as any).Store;
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
async function blobUrlToBase64(blobUrl: string): Promise<string | null> {
  try {
    if (blobUrl.startsWith("data:")) {
      return blobUrl;
    }
    const resp = await fetch(blobUrl);
    const blob = await resp.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string); // data URI: data:image/jpeg;base64,...
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Versión asincrónica que intenta descargar el media real desde un nodo DOM.
 * Usada por el dom-detector para mensajes con media.
 */
export async function parseMessageNodeAsync(node: HTMLElement): Promise<any> {
  const dataId = node.getAttribute("data-id") || node.id || "";
  
  // Detectar tipo de media desde el DOM
  const hasImage = !!node.querySelector('img[src^="blob:"]') || !!node.querySelector('img[src^="data:"]');
  const hasAudio = !!node.querySelector("audio") || !!node.querySelector('[data-testid*="audio"]');
  const hasVideo = !!node.querySelector("video") || !!node.querySelector('[data-testid*="video"]');
  const hasMedia = hasImage || hasAudio || hasVideo;

  if (!hasMedia) {
    return { id: dataId, hasMedia: false, mediaPayload: null };
  }

  // Detectar tipo de media desde el DOM para saber qué mime usar
  let domMime = "";
  if (hasImage) domMime = "image/jpeg";
  if (hasAudio) domMime = "audio/ogg";
  if (hasVideo) domMime = "video/mp4";

  // Intentar obtener la blob URL del DOM como alternativa
  const img = node.querySelector('img[src^="blob:"], img[src^="data:"]') as HTMLImageElement | null;
  const video = node.querySelector('video[src^="blob:"], video[src^="data:"], video[poster^="blob:"], video[poster^="data:"]') as HTMLVideoElement | null;
  let blobUrl: string | null = null;
  if (hasImage) {
    blobUrl = img?.src || null;
  } else if (hasVideo) {
    blobUrl = video?.currentSrc || video?.getAttribute("src") || video?.poster || null;
  }

  // 1. Intentar via Store
  const msgModel = findMsgModelInStore(dataId);
  if (msgModel) {
    const mediaData = await downloadMediaFromStore(msgModel);
    if (mediaData) {
      return { id: dataId, hasMedia: true, mediaPayload: mediaData };
    }
  }

  // 2. Fallback: convertir blob URL del DOM a base64
  if (blobUrl) {
    try {
      const dataUri = await blobUrlToBase64(blobUrl);
      if (dataUri) {
        const detectedMime =
          dataUri.match(/^data:([^;]+);/i)?.[1] || domMime;
        return {
          id: dataId,
          hasMedia: true,
          mediaPayload: {
            body: dataUri,
            mimeType: detectedMime,
            mimetype: detectedMime,
            caption: "",
          },
        };
      }
    } catch {}
  }

  // 3. No se pudo descargar, enviar metadata sin base64
  return {
    id: dataId,
    hasMedia: true,
    mediaPayload: {
      body: null,
      mimeType: domMime,
      mimetype: domMime,
      size: 0,
    },
  };
}

// Exponer al window para que dom-detector pueda usarlo
(window as any).__engineParser = { parseMessageNodeAsync };
