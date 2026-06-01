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

  // Descargar media binaria para mensajes entrantes multimedia con reintentos para esperar a que WhatsApp termine su descarga local
  if (msg.isMedia && !msg.id?.fromMe && media) {
    try {
      const WPP = getWPP();
      let base64Data: string | null = null;
      let retries = 6; // 6 intentos (15 segundos en total)

      while (!base64Data && retries > 0) {
        // Método 1: Intentar leer del blob URL nativo que WhatsApp ya descargó en el navegador (Evita 403 Forbidden)
        const possibleBlobUrls = [
          msg.clientUrl,
          msg.mediaData?.clientUrl,
          msg.mediaData?.renderableUrl,
          msg.mediaData?.previewUrl,
          msg.deprecatedMms3Url
        ].filter((u): u is string => typeof u === "string" && u.startsWith("blob:"));

        for (const blobUrl of possibleBlobUrls) {
          console.log("[MAPLE MULTIMEDIA] Intentando extraer desde blob URL local:", blobUrl);
          base64Data = await blobUrlToBase64(blobUrl);
          if (base64Data) {
            console.log("[MAPLE MULTIMEDIA] Sincronización exitosa desde blob local!");
            break;
          }
        }

        // Método 2: Usar API nativa de descarga de WPP
        if (!base64Data && WPP) {
          console.log("[MAPLE MULTIMEDIA] Intentando descargar vía WPP...");
          try {
            const res = await WPP.chat.downloadMedia(msg.id);
            if (res) {
              base64Data = res;
            }
          } catch (e) {}
        }

        // Método 3: Descarga directa desde el modelo de mensaje si está disponible
        if (!base64Data && typeof msg.downloadMedia === "function") {
          console.log("[MAPLE MULTIMEDIA] Intentando descargar vía msg.downloadMedia()...");
          try {
            const res = await msg.downloadMedia();
            if (typeof res === "string") {
              base64Data = res;
            } else if (res && (res.body || res.data)) {
              base64Data = res.body || res.data;
            }
          } catch (e) {}
        }

        if (base64Data) {
          media.base64 = base64Data;
          break;
        }

        retries--;
        if (retries > 0) {
          console.log(`[MAPLE MULTIMEDIA] Archivo no listo aún. Esperando 2.5s antes del reintento... (${retries} intentos restantes)`);
          await new Promise((r) => setTimeout(r, 2500));
        }
      }

      if (!base64Data) {
        console.warn("[MAPLE MULTIMEDIA] No se pudo obtener la multimedia tras 15 segundos para el mensaje:", msg.id?._serialized);
      }
    } catch (err) {
      console.error("[MAPLE MULTIMEDIA] Error general descargando media:", err);
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
        const numObj = await WPP.whatsapp.ApiContact.getPhoneNumber(realChatId);
        if (numObj && numObj._serialized) {
          realChatId = numObj._serialized;
        }
      } catch (err) {
        console.warn("[EventEngine] Error al obtener número para LID chatId:", realChatId, err);
      }
    }
    if (realFrom && realFrom.endsWith("@lid")) {
      try {
        const numObj = await WPP.whatsapp.ApiContact.getPhoneNumber(realFrom);
        if (numObj && numObj._serialized) {
          realFrom = numObj._serialized;
        }
      } catch (err) {}
    }
    if (realTo && realTo.endsWith("@lid")) {
      try {
        const numObj = await WPP.whatsapp.ApiContact.getPhoneNumber(realTo);
        if (numObj && numObj._serialized) {
          realTo = numObj._serialized;
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
