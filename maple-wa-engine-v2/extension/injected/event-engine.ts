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

  const hasMediaIndicators = msg.isMedia || msg.mediaKey || msg.clientUrl || msg.deprecatedMms3Url || msg.mediaData;
  const shouldDownloadMedia = hasMediaIndicators && media;

  console.log("[MAPLE EVENT ENGINE] Decisión media:", {
    hasMediaIndicators,
    shouldDownloadMedia,
    mediaExtracted: !!media,
    msgType: msg.type,
  });

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
      let retries = isVideo ? 12 : 6;

      while (!base64Data && retries > 0) {
        // Método 1: Intentar leer del blob URL nativo que WhatsApp ya descargó en el navegador (Evita 403 Forbidden)
        // Ahora también incluimos URLs HTTPS directas de WhatsApp (deprecatedMms3Url, etc.)
        const possibleUrls = [
          msg.clientUrl,
          msg.mediaData?.clientUrl,
          msg.mediaData?.renderableUrl,
          msg.mediaData?.previewUrl,
          msg.deprecatedMms3Url,
        ].filter((u): u is string => typeof u === "string" && (u.startsWith("blob:") || u.startsWith("https://mmg.whatsapp.net")));

        for (const url of possibleUrls) {
          console.log("[MAPLE MULTIMEDIA] Intentando extraer desde URL:", url.substring(0, 60) + "...");
          try {
            if (url.startsWith("blob:")) {
              base64Data = await blobUrlToBase64(url);
            } else {
              // Intentar fetch directo a URL de WhatsApp (mismo origen, mismas cookies)
              const resp = await fetch(url, { credentials: "include" });
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
            console.log("[MAPLE MULTIMEDIA] downloadMediaCrypted result type:", typeof res, !!res);
            if (typeof res === "string") {
              base64Data = res;
            } else if (res && (res.body || res.data)) {
              base64Data = res.body || res.data;
            }
          } catch (e: any) {
            console.warn("[MAPLE MULTIMEDIA] downloadMediaCrypted failed:", e?.message || e);
          }
        }

        // Método 3: Usar API nativa de descarga de WPP (con ID serializado como string)
        if (!base64Data && WPP && WPP.chat) {
          const wppMethod = WPP.chat.downloadMediaMessage || WPP.chat.downloadMedia;
          if (typeof wppMethod === "function") {
            console.log("[MAPLE MULTIMEDIA] Intentando descargar vía WPP...");
            try {
              const msgId = msg.id?._serialized || msg.id;
              const res = await wppMethod(msgId);
              console.log("[MAPLE MULTIMEDIA] WPP result type:", typeof res, !!res);
              if (typeof res === "string") {
                base64Data = res;
              } else if (res && (res.body || res.data)) {
                base64Data = res.body || res.data;
              }
            } catch (e: any) {
              console.warn("[MAPLE MULTIMEDIA] WPP download failed:", e?.message || e);
            }
          } else {
            console.warn("[MAPLE MULTIMEDIA] WPP.chat.downloadMediaMessage/downloadMedia no disponible");
          }
        }

        // Método 4: Descarga directa desde el modelo de mensaje
        if (!base64Data && typeof msg.downloadMedia === "function") {
          console.log("[MAPLE MULTIMEDIA] Intentando descargar vía msg.downloadMedia()...");
          try {
            const res = await msg.downloadMedia();
            console.log("[MAPLE MULTIMEDIA] msg.downloadMedia result type:", typeof res, !!res);
            if (typeof res === "string") {
              base64Data = res;
            } else if (res && (res.body || res.data)) {
              base64Data = res.body || res.data;
            }
          } catch (e: any) {
            console.warn("[MAPLE MULTIMEDIA] msg.downloadMedia failed:", e?.message || e);
          }
        }

        if (base64Data) {
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

        retries--;
        if (retries > 0) {
          console.log(`[MAPLE MULTIMEDIA] Archivo no listo aún. Esperando 2.5s antes del reintento... (${retries} intentos restantes)`);
          await new Promise((r) => setTimeout(r, isVideo ? 3000 : 2500));
        }
      }

      if (!base64Data) {
        console.warn("[MAPLE MULTIMEDIA] No se pudo obtener la multimedia tras reintentos para el mensaje:", msg.id?._serialized);
        media.missing_media = true;
        media.extraction_error = "timeout_after_retries";
      }
    } catch (err) {
      console.error("[MAPLE MULTIMEDIA] Error general descargando media:", err);
      media.missing_media = true;
      media.extraction_error = "exception_during_download";
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
