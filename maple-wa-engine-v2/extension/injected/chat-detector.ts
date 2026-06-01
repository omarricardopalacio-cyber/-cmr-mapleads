// ============================================================
// MAPLE WA ENGINE — Chat Detector (Injected Script)
// Extrae lista de chats y datos del chat activo
// ============================================================

import { getWPP } from "./wpp-bootstrap";
import { postFromInjected } from "../bridge/postmessage";

export async function getActiveChat(): Promise<any> {
  const WPP = getWPP();
  if (!WPP) throw new Error("WPP no disponible");

  const chat = await WPP.chat.getActiveChat();
  return chat ? normalizeChat(chat) : null;
}

export async function getChatList(): Promise<any[]> {
  const WPP = getWPP();
  if (!WPP) throw new Error("WPP no disponible");

  const chats = await WPP.chat.list();
  return chats.map(normalizeChat);
}

export async function findChat(chatId: string): Promise<any> {
  const WPP = getWPP();
  if (!WPP) throw new Error("WPP no disponible");

  const chat = await WPP.chat.find(chatId);
  return chat ? normalizeChat(chat) : null;
}

export async function getChatMessages(
  chatId: string,
  options: { count?: number; direction?: "before" | "after"; id?: string } = {}
): Promise<any[]> {
  const WPP = getWPP();
  if (!WPP) throw new Error("WPP no disponible");

  const msgs = await WPP.chat.getMessages(chatId, {
    count: options.count || 50,
    direction: options.direction || "before",
    id: options.id,
  });

  return msgs.map(normalizeMessage);
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

  return {
    messageId: msg.id?._serialized,
    chatId: msg.id?.remote?._serialized,
    from: msg.from?._serialized || msg.id?.remote?._serialized,
    to: msg.to?._serialized,
    body,
    type: msg.type,
    timestamp: msg.t,
    fromMe: msg.id?.fromMe || false,
    author,
    ack: msg.ack,
  };
}
