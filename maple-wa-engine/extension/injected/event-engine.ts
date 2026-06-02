// ============================================================
// MAPLE WA ENGINE — Event Engine (Injected Script)
// Registra todos los listeners de WPP y los reenvía al bridge
// ============================================================

import { waitForWPP, getWPP } from "./wpp-bootstrap";
import { postFromInjected } from "../bridge/postmessage";
import type { WAEventType } from "../shared/types";
import { isBase64Thumbnail, sanitizeMessageBody } from "../shared/message-text";

let listenersInitialized = false;
let cleanupFns: Array<() => void> = [];

export async function initEventEngine(): Promise<void> {
  if (listenersInitialized) {
    console.warn("[EventEngine] Listeners ya inicializados, ignorando");
    return;
  }

  try {
    await waitForWPP();
    const WPP = getWPP();
    if (!WPP) {
      throw new Error("WPP no disponible");
    }

    registerNewMessage(WPP);
    registerActiveChat(WPP);
    registerPresenceChange(WPP);
    registerLabelUpdate(WPP);
    registerStreamInfo(WPP);

    listenersInitialized = true;
    console.log("[EventEngine] Todos los listeners registrados");
  } catch (err) {
    console.error("[EventEngine] Error inicializando:", err);
    throw err;
  }
}

function emit(event: WAEventType, payload: any): void {
  postFromInjected("WA_EVENT", { event, payload });
}

/**
 * Valida que un base64 contenga datos de imagen/video reales.
 * Retorna los primeros bytes hex para diagnóstico.
 */
function validateBase64Media(base64Data: string): { valid: boolean; firstBytesHex: string; detectedType: string } {
  try {
    // Quitar prefijo data URI si existe
    const clean = base64Data.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
    if (clean.length < 8) return { valid: false, firstBytesHex: "too_short", detectedType: "unknown" };

    const binary = atob(clean);
    const bytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) bytes[i] = binary.charCodeAt(i);

    const hex = [...bytes].map(b => b.toString(16).padStart(2, "0")).join(" ");

    // Firmas mágicas
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) return { valid: true, firstBytesHex: hex, detectedType: "image/jpeg" };
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return { valid: true, firstBytesHex: hex, detectedType: "image/png" };
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return { valid: true, firstBytesHex: hex, detectedType: "image/gif" };
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return { valid: true, firstBytesHex: hex, detectedType: "image/webp" };
    if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x00 && (bytes[3] === 0x18 || bytes[3] === 0x20) && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return { valid: true, firstBytesHex: hex, detectedType: "video/mp4" };
    if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) return { valid: true, firstBytesHex: hex, detectedType: "video/webm" };

    return { valid: false, firstBytesHex: hex, detectedType: "unknown/encrypted" };
  } catch (e) {
    return { valid: false, firstBytesHex: "decode_error", detectedType: "error" };
  }
}

function registerNewMessage(WPP: NonNullable<typeof window.WPP>): void {
  const handler = async (...args: any[]) => {
    const msg = args[0];
    if (!msg) return;

    try {
      const normalized = await normalizeMessage(msg);
      emit("NEW_MESSAGE", normalized);
    } catch (err) {
      console.error("[EventEngine] Error normalizando mensaje:", err);
    }
  };

  WPP.prependListener("chat.new_message", handler, { objectify: true });
  cleanupFns.push(() => WPP.off("chat.new_message", handler));
}

function registerActiveChat(WPP: NonNullable<typeof window.WPP>): void {
  const handler = (chat: any) => {
    if (!chat) return;

    try {
      const normalized = normalizeChat(chat);
      emit("ACTIVE_CHAT_CHANGED", normalized);
    } catch (err) {
      console.error("[EventEngine] Error normalizando chat activo:", err);
    }
  };

  WPP.on("chat.active_chat", handler);
  cleanupFns.push(() => WPP.off("chat.active_chat", handler));
}

function registerPresenceChange(WPP: NonNullable<typeof window.WPP>): void {
  const handler = (data: any) => {
    emit("PRESENCE_CHANGED", {
      chatId: data.chatId || data.id?._serialized,
      isOnline: data.isOnline,
      isTyping: data.isTyping,
      isRecording: data.isRecording,
      lastSeen: data.lastSeen,
    });
  };

  WPP.on("chat.presence_change", handler);
  cleanupFns.push(() => WPP.off("chat.presence_change", handler));
}

function registerLabelUpdate(WPP: NonNullable<typeof window.WPP>): void {
  const handler = (data: any) => {
    emit("LABEL_UPDATED", {
      chatId: data.chatId || data.id?._serialized,
      labels: data.labels || [],
      action: data.action,
    });
  };

  WPP.on("chat.update_label", handler);
  cleanupFns.push(() => WPP.off("chat.update_label", handler));
}

function registerStreamInfo(WPP: NonNullable<typeof window.WPP>): void {
  const handler = (state: string) => {
    emit("CONNECTION_STATE_CHANGED", {
      state,
      isSynchronized: state === "NORMAL",
    });
  };

  WPP.on("conn.stream_info_changed", handler);
  cleanupFns.push(() => WPP.off("conn.stream_info_changed", handler));
}

function getMyPhoneNumber(): string | undefined {
  try {
    const WPP = getWPP();
    if (!WPP) return undefined;
    // Intentar múltiples APIs de WPP para obtener el número
    const me = WPP.whatsapp?.UserPrefs?.getMaybeMeUser?.() || WPP.whatsapp?.UserPrefs?.getMe?.();
    if (me?.user) return me.user;
    const conn = WPP.whatsapp?.Stream?.get?.();
    if (conn?.wid?.user) return conn.wid.user;
    return undefined;
  } catch {
    return undefined;
  }
}

function createWidSafely(WPP: any, jid: string): any {
  try {
    if (WPP.whatsapp?.createWid) return WPP.whatsapp.createWid(jid);
    if (WPP.whatsapp?.WidFactory?.createWid) return WPP.whatsapp.WidFactory.createWid(jid);
    if (WPP.whatsapp?.Wid?.create) return WPP.whatsapp.Wid.create(jid);
    // Fallback: construir manualmente el objeto Wid mínimo
    const [user, server] = jid.split("@");
    return { user, server, _serialized: jid };
  } catch (e) {
    return null;
  }
}

// ============================================================
// Normalizadores
// ============================================================

async function blobUrlToBase64(blobUrl: string): Promise<string | null> {
  try {
    const resp = await fetch(blobUrl);
    const blob = await resp.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(reader.result as string);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.warn("[MAPLE MULTIMEDIA] Error convirtiendo blob URL a base64:", err);
    return null;
  }
}

async function normalizeMessage(msg: any): Promise<any> {
  // DIAGNÓSTICO: Loguear TODO mensaje entrante para ver propiedades
  console.log("[MAPLE EVENT ENGINE] normalizeMessage llamado:", {
    id: msg.id?._serialized,
    type: msg.type,
    isMedia: msg.isMedia,
    hasMediaKey: !!msg.mediaKey,
    hasClientUrl: !!msg.clientUrl,
    hasDeprecatedMms3Url: !!msg.deprecatedMms3Url,
    hasBody: !!msg.body,
    bodyPreview: msg.body ? String(msg.body).substring(0, 60) : null,
    keys: Object.keys(msg).filter(k => k.includes("media") || k.includes("url") || k.includes("blob")),
  });

  let author: any = undefined;
  if (msg.__x_author) {
    author = {
      device: msg.__x_author.device,
      server: msg.__x_author.server,
      user: msg.__x_author.user,
      serialized: msg.__x_author._serialized,
    };
  }

  const phoneNumber = getMyPhoneNumber();

  const media = extractMediaData(msg);

  // Detección robusta de media: usar múltiples propiedades porque msg.isMedia puede ser undefined
  const hasMediaIndicators = msg.isMedia || msg.mediaKey || msg.clientUrl || msg.deprecatedMms3Url || msg.mediaData;
  const shouldDownloadMedia = hasMediaIndicators && media;

  console.log("[MAPLE EVENT ENGINE] Decisión media:", {
    hasMediaIndicators,
    shouldDownloadMedia,
    mediaExtracted: !!media,
    msgType: msg.type,
  });

  // Descargar media binaria para mensajes multimedia (entrantes y salientes) con reintentos
  if (shouldDownloadMedia) {
    // DIAGNÓSTICO: Loguear estado inicial del media
    console.log("[MAPLE MULTIMEDIA] Mensaje multimedia detectado:", {
      type: msg.type,
      isMedia: msg.isMedia,
      id: msg.id?._serialized,
      hasMediaData: !!msg.mediaData,
      hasClientUrl: !!msg.clientUrl,
      hasDeprecatedMms3Url: !!msg.deprecatedMms3Url,
      hasDownloadMedia: typeof msg.downloadMedia === "function",
      hasDownloadMediaCrypted: typeof msg.downloadMediaCrypted === "function",
      mediaDataKeys: msg.mediaData ? Object.keys(msg.mediaData) : [],
    });

    try {
      const WPP = getWPP();
      let base64Data: string | null = null;
      const isVideo = msg.type === "video";
      let retries = isVideo ? 12 : 12; // Aumentado a 12 para imágenes también - más tiempo para descarga

      while (!base64Data && retries > 0) {
        // Método 1: Intentar leer del blob URL nativo que WhatsApp ya descargó en el navegador (debe ser blob:)
        const possibleUrls = [
          msg.clientUrl,
          msg.mediaData?.clientUrl,
          msg.mediaData?.renderableUrl,
          msg.mediaData?.previewUrl,
          msg.deprecatedMms3Url,
        ].filter((u): u is string => typeof u === "string" && u.startsWith("blob:"));

        for (const url of possibleUrls) {
          console.log("[MAPLE MULTIMEDIA] Intentando extraer desde URL:", url.substring(0, 60) + "...");
          try {
            if (url.startsWith("blob:")) {
              base64Data = await blobUrlToBase64(url);
            } else {
              // Sin credentials explícito para evitar CORS wildcard + credentials:include rejection
              const resp = await fetch(url);
              if (resp.ok) {
                const blob = await resp.blob();
                base64Data = await new Promise<string | null>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(reader.result as string);
                  reader.onerror = () => reject(reader.error);
                  reader.readAsDataURL(blob);
                });
              }
            }
            if (base64Data) {
              console.log("[MAPLE MULTIMEDIA] Sincronización exitosa desde URL!");
              break;
            }
          } catch (urlErr) {
            console.warn("[MAPLE MULTIMEDIA] Fallo URL:", url.substring(0, 40), urlErr);
          }
        }

        // Método 2: Descarga encriptada nativa (más confiable para media entrante)
        if (!base64Data && typeof msg.downloadMediaCrypted === "function") {
          console.log("[MAPLE MULTIMEDIA] Intentando descargar vía msg.downloadMediaCrypted()...");
          try {
            const res = await msg.downloadMediaCrypted();
            console.log("[MAPLE MULTIMEDIA] downloadMediaCrypted result:", typeof res, res?.constructor?.name, Object.keys(res || {}));
            if (typeof res === "string") {
              base64Data = res;
            } else if (res && res.data) {
              base64Data = res.data;
            }
          } catch (e: any) {
            console.warn("[MAPLE MULTIMEDIA] downloadMediaCrypted failed:", e?.message || e);
          }
        }

        // Método 3: Descarga directa desde el modelo de mensaje
        if (!base64Data && typeof msg.downloadMedia === "function") {
          console.log("[MAPLE MULTIMEDIA] Intentando descargar vía msg.downloadMedia()...");
          try {
            const res = await msg.downloadMedia();
            console.log("[MAPLE MULTIMEDIA] msg.downloadMedia result:", typeof res, res?.constructor?.name, Object.keys(res || {}));
            if (typeof res === "string") {
              base64Data = res;
            } else if (res && res.data) {
              base64Data = res.data;
            }
          } catch (e: any) {
            console.warn("[MAPLE MULTIMEDIA] msg.downloadMedia failed:", e?.message || e);
          }
        }

        // Método 4: Usar API nativa de descarga de WPP (con ID serializado como string)
        if (!base64Data && WPP && WPP.chat) {
          const wppMethod = WPP.chat.downloadMediaMessage || WPP.chat.downloadMedia;
          if (typeof wppMethod === "function") {
            console.log("[MAPLE MULTIMEDIA] Intentando descargar vía WPP...");
            try {
              const msgId = msg.id?._serialized || msg.id;
              const res = await wppMethod(msgId);
              console.log("[MAPLE MULTIMEDIA] WPP result:", typeof res, res?.constructor?.name, Object.keys(res || {}), JSON.stringify(res)?.substring(0, 200));
              if (typeof res === "string") {
                base64Data = res;
              } else if (res) {
                if (res.body) base64Data = res.body;
                else if (res.data) base64Data = res.data;
                else if (res.base64) base64Data = res.base64;
                else if (res._blob) {
                  const blob = res._blob;
                  // Verificar que el Blob tenga contenido
                  if (blob.size > 0) {
                    base64Data = await new Promise<string | null>((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () => resolve(reader.result as string);
                      reader.onerror = () => reject(reader.error);
                      reader.readAsDataURL(blob);
                    });
                  } else {
                    console.warn("[MAPLE MULTIMEDIA] WPP devolvió Blob vacío, reintentando...");
                  }
                } else if (res._arrayBuffer) {
                  const bytes = new Uint8Array(res._arrayBuffer);
                  let binary = "";
                  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
                  base64Data = "data:" + (msg.mimetype || "application/octet-stream") + ";base64," + btoa(binary);
                }
              }
            } catch (e: any) {
              console.warn("[MAPLE MULTIMEDIA] WPP download failed:", e?.message || e);
            }
          } else {
            console.warn("[MAPLE MULTIMEDIA] WPP.chat.downloadMediaMessage/downloadMedia no disponible");
          }
        }

        if (base64Data) {
          const validation = validateBase64Media(base64Data);
          console.log("[MAPLE MULTIMEDIA] Base64 validación:", {
            valid: validation.valid,
            detectedType: validation.detectedType,
            firstBytes: validation.firstBytesHex,
            length: base64Data.length,
            approxBytes: Math.ceil(base64Data.length * 0.75),
          });

          if (!validation.valid) {
            console.warn("[MAPLE MULTIMEDIA] Base64 NO es una imagen válida. Probablemente datos encriptados o corruptos. Reintentando...");
            base64Data = null; // Forzar reintento con otro método
          } else {
            const approxBytes = Math.ceil(base64Data.length * 0.75);
            if (approxBytes > 20 * 1024 * 1024) {
              console.warn(
                "[MAPLE MULTIMEDIA] Archivo > 20MB; se enviará solo metadata (evita timeout en servidor)"
              );
            } else {
              media.base64 = base64Data;
              media.type = msg.type;
            }
            break;
          }
        }

        retries--;
        if (retries > 0) {
          console.log(`[MAPLE MULTIMEDIA] Archivo no listo aún. Esperando 2.5s antes del reintento... (${retries} intentos restantes)`);
          await new Promise((r) => setTimeout(r, isVideo ? 3000 : 2500));
        }
      }

      if (!base64Data) {
        console.warn("[MAPLE MULTIMEDIA] No se pudo obtener la multimedia tras reintentos para el mensaje:", msg.id?._serialized);
        console.log("[MAPLE MULTIMEDIA] NO enviando evento - DOMDetector se encargará de extraer del DOM");
        return null; // No enviar evento, dejar que DOMDetector lo maneje
      }
    } catch (err) {
      console.error("[MAPLE MULTIMEDIA] Error general descargando media:", err);
      console.log("[MAPLE MULTIMEDIA] NO enviando evento - DOMDetector se encargará de extraer del DOM");
      return null; // No enviar evento, dejar que DOMDetector lo maneje
    }
  }

  const cleanBody = sanitizeMessageBody({
    body: msg.body,
    caption: msg.caption,
    isMedia: msg.isMedia,
    type: msg.type,
  });

  if (msg.isMedia && isBase64Thumbnail(msg.body)) {
    console.log(
      `[MAPLE EVENT ENGINE] Filtrado thumbnail base64 en body para mensaje ${msg.id?._serialized}. Usando caption.`
    );
  }

  const WPP = getWPP();
  let realChatId = msg.id?.remote?._serialized;
  let realFrom = msg.from?._serialized || msg.id?.remote?._serialized;
  let realTo = msg.to?._serialized;

  // Si son JIDs de tipo LID, resolver su número telefónico real (@c.us) para evitar duplicación y chats "sin número"
  if (WPP) {
    if (realChatId && realChatId.endsWith("@lid")) {
      try {
        const wid = createWidSafely(WPP, realChatId);
        if (!wid) {
          console.warn("[EventEngine] No se pudo crear Wid para:", realChatId);
        } else {
          const numObj = await WPP.whatsapp.ApiContact.getPhoneNumber(wid);
          if (numObj && numObj._serialized) {
            realChatId = numObj._serialized;
          }
        }
      } catch (err) {
        console.warn("[EventEngine] Error al obtener número para LID chatId:", realChatId, err);
      }
    }
    if (realFrom && realFrom.endsWith("@lid")) {
      try {
        const wid = createWidSafely(WPP, realFrom);
        if (!wid) {
          console.warn("[EventEngine] No se pudo crear Wid para:", realFrom);
        } else {
          const numObj = await WPP.whatsapp.ApiContact.getPhoneNumber(wid);
          if (numObj && numObj._serialized) {
            realFrom = numObj._serialized;
          }
        }
      } catch (err) {}
    }
    if (realTo && realTo.endsWith("@lid")) {
      try {
        const wid = createWidSafely(WPP, realTo);
        if (!wid) {
          console.warn("[EventEngine] No se pudo crear Wid para:", realTo);
        } else {
          const numObj = await WPP.whatsapp.ApiContact.getPhoneNumber(wid);
          if (numObj && numObj._serialized) {
            realTo = numObj._serialized;
          }
        }
      } catch (err) {}
    }
  }

  // Extraer información de contacto/nombre del remitente si está disponible
  let pushname = msg.pushname || msg.sender?.pushname || undefined;
  let notifyName = msg.sender?.pushname || msg.pushname || undefined;
  let displayName = msg.sender?.displayName || msg.sender?.name || msg.sender?.formattedName || pushname || undefined;

  // Si no hay nombre y tenemos el contacto de WPP, cargarlo
  if (!displayName && WPP && realFrom) {
    try {
      const contactObj = await WPP.contact.get(realFrom);
      if (contactObj) {
        pushname = contactObj.pushname || pushname;
        notifyName = contactObj.pushname || notifyName;
        displayName = contactObj.name || contactObj.displayName || contactObj.pushname || contactObj.formattedName || undefined;
      }
    } catch (err) {}
  }

  return {
    messageId: msg.id?._serialized,
    chatId: realChatId,
    from: realFrom,
    to: realTo,
    body: cleanBody,
    text: cleanBody,
    type: msg.type,
    timestamp: msg.t,
    fromMe: msg.id?.fromMe || false,
    author,
    media,
    ack: msg.ack,
    phoneNumber,
    pushname,
    notifyName,
    displayName,
  };
}

function normalizeChat(chat: any): any {
  let id = chat.id;
  if (typeof id === "string") {
    id = { _serialized: id, server: id.split("@")[1], user: id.split("@")[0] };
  }

  return {
    chatId: id?._serialized,
    user: id?.user,
    server: id?.server,
    name: chat.name || chat.formattedTitle || chat.contact?.displayName || "",
    isGroup: id?.server === "g.us",
    canSend: chat.canSend ?? true,
    unreadCount: chat.unreadCount || 0,
    labels: chat.labels || [],
    timestamp: chat.t,
  };
}

function extractMediaData(msg: any): any {
  if (!["image", "video", "audio", "ptt", "document"].includes(msg.type)) {
    return undefined;
  }
  return {
    type: msg.type,
    mimetype: msg.mimetype,
    filehash: msg.filehash,
    mediaKey: msg.mediaKey,
    size: msg.size,
    duration: msg.duration,
    caption: msg.caption,
  };
}

export function destroyEventEngine(): void {
  for (const fn of cleanupFns) {
    try { fn(); } catch (e) {}
  }
  cleanupFns = [];
  listenersInitialized = false;
}
