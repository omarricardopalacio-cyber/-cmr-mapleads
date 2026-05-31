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

  // Descargar media binaria para mensajes entrantes multimedia
  if (msg.isMedia && !msg.id?.fromMe && media) {
    try {
      const WPP = getWPP();
      if (WPP) {
        const base64Data = await WPP.chat.downloadMedia(msg.id);
        if (base64Data) {
          media.base64 = base64Data;
        }
      }
    } catch (err) {
      console.error("[MAPLE MULTIMEDIA] Error al descargar media de WhatsApp:", err);
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

  return {
    messageId: msg.id?._serialized,
    chatId: msg.id?.remote?._serialized,
    from: msg.from?._serialized || msg.id?.remote?._serialized,
    to: msg.to?._serialized,
    body: cleanBody,
    text: cleanBody,
    type: msg.type,
    timestamp: msg.t,
    fromMe: msg.id?.fromMe || false,
    author,
    media,
    ack: msg.ack,
    phoneNumber,
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
