// ============================================================
// MAPLE WA ENGINE — Chat Detector (Injected Script)
// Extrae lista de chats y datos del chat activo
// ============================================================

import { getWPP, patchWhatsAppCompat } from "./wpp-bootstrap";

export async function getActiveChat(): Promise<any> {
  const WPP = getWPP();
  if (!WPP) throw new Error("WPP no disponible");

  const chat = await WPP.chat.getActiveChat();
  return chat ? normalizeChat(chat) : null;
}

export async function getChatList(options: { limit?: number; slim?: boolean } = {}): Promise<any[]> {
  const WPP = getWPP();
  if (!WPP) throw new Error("WPP no disponible");

  const chats = await WPP.chat.list();
  const slim = options.slim !== false;
  let mapped = chats.map((c: any) => (slim ? normalizeChatSlim(c) : normalizeChat(c)));

  // Solo 1:1 (sin grupos)
  mapped = mapped.filter((c: any) => !c.isGroup && !String(c.chatId || "").includes("@g.us"));

  // Hasta ~1500 chats 1:1 (cuentas grandes ~1000+)
  const limit = options.limit && options.limit > 0 ? Math.min(options.limit, 1500) : undefined;
  if (limit) mapped = mapped.slice(0, limit);

  return mapped;
}

export async function findChat(chatId: string): Promise<any> {
  const WPP = getWPP();
  if (!WPP) throw new Error("WPP no disponible");

  const chat = await WPP.chat.find(chatId);
  return chat ? normalizeChat(chat) : null;
}

/** Lee msgs ya cargados en el chat sin pasar por getMessages (evita isBot). */
function readMsgsFromChatModel(chat: any, count: number): any[] {
  if (!chat) return [];
  let models: any[] = [];
  try {
    if (typeof chat.msgs?.getModelsArray === "function") {
      models = chat.msgs.getModelsArray();
    } else if (Array.isArray(chat.msgs?.models)) {
      models = chat.msgs.models;
    } else if (typeof chat.msgs?.toArray === "function") {
      models = chat.msgs.toArray();
    }
  } catch {
    return [];
  }
  return [...models]
    .filter(Boolean)
    .sort((a, b) => Number(a?.t || 0) - Number(b?.t || 0))
    .slice(-Math.max(1, count));
}

async function loadChatModel(WPP: any, chatId: string): Promise<any | null> {
  try {
    if (typeof WPP.chat.get === "function") {
      const c = await WPP.chat.get(chatId);
      if (c) return c;
    }
  } catch {
    /* continue */
  }
  try {
    return (await WPP.chat.find(chatId)) || null;
  } catch {
    return null;
  }
}

export async function getChatMessages(
  chatId: string,
  options: { count?: number; direction?: "before" | "after"; id?: string } = {}
): Promise<any[]> {
  const WPP = getWPP();
  if (!WPP) throw new Error("WPP no disponible");

  patchWhatsAppCompat(WPP);

  const count = options.count || 50;
  const direction = options.direction || "before";

  // 1) API oficial WA-JS
  try {
    const msgs = await WPP.chat.getMessages(chatId, {
      count,
      direction,
      id: options.id,
    });
    if (Array.isArray(msgs) && msgs.length > 0) {
      return msgs.map(normalizeMessage);
    }
  } catch (err: any) {
    console.warn(
      "[ChatDetector] getMessages falló, usando fallback local:",
      err?.message || err
    );
  }

  // 2) Fallback: colección msgs ya en memoria (no hidrata MsgModel vía getValidatedSender)
  const chat = await loadChatModel(WPP, chatId);
  const local = readMsgsFromChatModel(chat, count);
  if (local.length > 0) {
    return local.map(normalizeMessage);
  }

  // 3) Último recurso: MsgStore filtrado por remote
  try {
    const store =
      (WPP as any).whatsapp?.MsgStore ||
      (WPP as any).whatsapp?.MsgCollection;
    const all =
      store?.getModelsArray?.() ||
      (typeof store?.toArray === "function" ? store.toArray() : []);
    if (Array.isArray(all) && all.length) {
      const filtered = all
        .filter((m: any) => {
          const remote =
            m?.id?.remote?._serialized ||
            m?.id?.remote ||
            m?.from?._serialized ||
            m?.to?._serialized;
          return String(remote) === chatId;
        })
        .sort((a: any, b: any) => Number(a?.t || 0) - Number(b?.t || 0))
        .slice(-count);
      return filtered.map(normalizeMessage);
    }
  } catch {
    /* ignore */
  }

  return [];
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
    labels: (chat.labels || []).map((l: any) => (typeof l === "string" ? l : l.id)),
    timestamp: chat.t || chat.lastMessage?.t,
    lastMessage: chat.lastMessage ? normalizeMessage(chat.lastMessage) : undefined,
    pin: chat.pin,
    mute: chat.mute,
  };
}

/** Payload liviano para importación de historial (evita timeout por postMessage gigante). */
function normalizeChatSlim(chat: any): any {
  let id = chat.id;
  if (typeof id === "string") {
    id = { _serialized: id, server: id.split("@")[1], user: id.split("@")[0] };
  }
  const name = chat.name || chat.formattedTitle || chat.contact?.displayName || "";
  const labels = (chat.labels || [])
    .map((l: any) => (typeof l === "string" ? l : l?.id ?? l?.name))
    .filter(Boolean)
    .slice(0, 10);

  return {
    chatId: id?._serialized,
    user: id?.user,
    server: id?.server,
    name,
    isGroup: id?.server === "g.us",
    labels,
    timestamp: chat.t || chat.lastMessage?.t,
  };
}

function normalizeMessage(msg: any): any {
  let author: any = undefined;
  if (msg.__x_author) {
    author = {
      device: msg.__x_author.device,
      server: msg.__x_author.server,
      user: msg.__x_author.user,
      serialized: msg.__x_author._serialized,
    };
  }

  let body = msg.body || "";
  if (!body && ["image", "video", "document"].includes(msg.type)) {
    body = msg.caption || "";
  }

  const remote =
    msg.id?.remote?._serialized ||
    (typeof msg.id?.remote === "string" ? msg.id.remote : undefined);

  return {
    messageId: msg.id?._serialized || (typeof msg.id === "string" ? msg.id : undefined),
    chatId: remote,
    from: msg.from?._serialized || remote,
    to: msg.to?._serialized,
    body,
    type: msg.type,
    timestamp: msg.t,
    fromMe: msg.id?.fromMe || msg.fromMe || false,
    author,
    ack: msg.ack,
  };
}
