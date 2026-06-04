// ============================================================
// CONVERSATIONS MODULE — Types
// ============================================================

export interface Conversation {
  id: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  profilePicture?: string;
  lastMessage?: Message;
  unreadCount: number;
  isGroup: boolean;
  labels: string[];
  updatedAt: string;
  createdAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  chatId: string;           // WhatsApp chat ID (e.g. "5511999999999@c.us")
  direction: "incoming" | "outgoing";
  type: "chat" | "image" | "video" | "audio" | "ptt" | "document" | "revoked";
  body: string;
  caption?: string;
  mediaUrl?: string;
  fromMe: boolean;
  author?: {
    name: string;
    phone: string;
  };
  ack: number;              // 0=pending, 1=sent, 2=received, 3=read
  timestamp: number;
  createdAt: string;
  synced: boolean;          // true = backend confirmó recepción
}

export interface Session {
  id: string;
  name: string;
  phoneNumber: string;
  status: "connected" | "disconnected" | "syncing";
  deviceId: string;
  profileName: string;
  profilePicture?: string;
  connectedAt: string;
}

export interface SendMessagePayload {
  sessionId: string;
  chatId: string;
  text: string;
  media?: File;
  quotedMsgId?: string;
}
