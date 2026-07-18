// ============================================================
// MAPLE WA ENGINE — Shared Types
// ============================================================

export type MessageType =
  | "chat"
  | "image"
  | "video"
  | "audio"
  | "ptt"
  | "document"
  | "location"
  | "vcard"
  | "revoked"
  | "status";

export type AckStatus =
  | "pending"
  | "server"
  | "device"
  | "read"
  | "played";

export interface WAAuthor {
  device: number;
  server: string;
  user: string;
  serialized: string;
}

export interface WAMessage {
  messageId: string;
  chatId: string;
  from: string;
  to: string;
  body: string;
  type: MessageType;
  timestamp: number;
  fromMe: boolean;
  author?: WAAuthor;
  media?: WAMedia;
  quotedMsg?: WAMessage;
  ack?: AckStatus;
}

export interface WAMedia {
  mimetype?: string;
  filehash?: string;
  mediaKey?: string;
  size?: number;
  duration?: number;
  caption?: string;
  url?: string;
}

export interface WAChat {
  chatId: string;
  user: string;
  server: string;
  name: string;
  isGroup: boolean;
  canSend: boolean;
  unreadCount: number;
  labels: string[];
  timestamp?: number;
  lastMessage?: WAMessage;
  picture?: string | null;
}

export interface WAContact {
  contactId: string;
  user: string;
  server: string;
  name: string;
  displayName?: string;
  pushname?: string;
  verifiedName?: string;
  shortName?: string;
  picture?: string | null;
  labels: string[];
  isBusiness: boolean;
  isGroup: boolean;
}

export interface WAPresence {
  chatId: string;
  isOnline: boolean;
  isTyping: boolean;
  isRecording: boolean;
  lastSeen?: number;
}

export interface WALabel {
  id: string;
  name: string;
  color?: string;
  hexColor?: string;
}

export interface SessionInfo {
  sessionId: string;
  browserId: string;
  deviceId: string;
  phoneNumber?: string;
  profileName?: string;
  profilePicture?: string;
  isReady: boolean;
  connectedAt: number;
  lastHeartbeat: number;
}

export interface SendPayload {
  chatId: string;
  text?: string;
  media?: File | Blob | string;
  caption?: string;
  quotedMsgId?: string;
  options?: Record<string, any>;
}

export interface CommandPayload {
  commandId: string;
  type: string;
  targetSessionId?: string;
  payload: Record<string, any>;
  timestamp: number;
}

export interface IngestPayload {
  sessionId: string;
  browserId: string;
  deviceId: string;
  events: WAEvent[];
}

export interface WAEvent {
  id: string;
  type: WAEventType;
  payload: any;
  timestamp: number;
}

export type WAEventType =
  | "NEW_MESSAGE"
  | "MESSAGE_SENT"
  | "MESSAGE_FAILED"
  | "MESSAGE_ACK"
  | "ACTIVE_CHAT_CHANGED"
  | "CONTACT_UPDATED"
  | "PRESENCE_CHANGED"
  | "LABEL_UPDATED"
  | "SESSION_READY"
  | "SESSION_LOST"
  | "HEARTBEAT"
  | "CONNECTION_STATE_CHANGED"
  | "CHAT_OPENED"
  | "CHAT_CLOSED"
  | "THEME_CHANGED";

export interface BackendCommand {
  id: string;
  type: "SEND_MESSAGE" | "SEND_MEDIA" | "SEND_BROADCAST" | "GET_CHATS" | "GET_CONTACTS" | "UPDATE_LABEL" | "PING";
  targetSessionId?: string;
  payload: Record<string, any>;
  createdAt: string;
}

export interface BridgeMessage {
  direction: "INJECTED_TO_CONTENT" | "CONTENT_TO_INJECTED" | "CONTENT_TO_BACKGROUND" | "BACKGROUND_TO_CONTENT";
  channel: "WA_EVENT" | "WA_COMMAND" | "WA_REQUEST" | "WA_RESPONSE";
  id?: string;
  event?: WAEventType | string;
  payload?: any;
  error?: string;
}
