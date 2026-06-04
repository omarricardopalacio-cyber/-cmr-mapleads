// ============================================================
// MAPLE WA ENGINE — IndexedDB + Dexie Layer
// ============================================================

import Dexie, { type Table } from "dexie";
import type { WAEvent, CommandPayload, WAMessage, WAContact, WAChat, SessionInfo } from "../shared/types";
import { CONSTANTS } from "../shared/contracts";

interface PendingCommand {
  id?: number;
  commandId: string;
  type: string;
  payload: Record<string, any>;
  createdAt: number;
  retryCount: number;
  lastAttempt?: number;
}

interface PendingMessage {
  id?: number;
  messageId: string;
  chatId: string;
  text?: string;
  media?: string;
  status: "pending" | "sending" | "sent" | "failed";
  createdAt: number;
  sentAt?: number;
  retryCount: number;
  error?: string;
}

interface EventQueueItem {
  id?: number;
  eventId: string;
  eventType: string;
  payload: any;
  timestamp: number;
  synced: boolean;
  retryCount: number;
}

interface CacheEntry {
  id?: number;
  key: string;
  value: any;
  expiresAt?: number;
  createdAt: number;
}

class MapleDatabase extends Dexie {
  events!: Table<EventQueueItem, number>;
  pendingCommands!: Table<PendingCommand, number>;
  pendingMessages!: Table<PendingMessage, number>;
  contacts!: Table<WAContact, string>;
  chats!: Table<WAChat, string>;
  sessions!: Table<SessionInfo, string>;
  cache!: Table<CacheEntry, number>;

  constructor() {
    super(CONSTANTS.DB_NAME);
    this.version(CONSTANTS.DB_VERSION).stores({
      events: "++id, eventId, eventType, synced, timestamp",
      pendingCommands: "++id, commandId, status, createdAt",
      pendingMessages: "++id, messageId, chatId, status, createdAt",
      contacts: "contactId, user, server, name, isGroup",
      chats: "chatId, user, server, name, isGroup, unreadCount",
      sessions: "sessionId, browserId, deviceId, isReady, connectedAt",
      cache: "++id, key, expiresAt, createdAt",
    });
  }
}

export const db = new MapleDatabase();

// ============================================================
// Event Queue
// ============================================================

export async function enqueueEvent(event: WAEvent): Promise<void> {
  await db.events.add({
    eventId: event.id,
    eventType: event.type,
    payload: event.payload,
    timestamp: event.timestamp,
    synced: false,
    retryCount: 0,
  });
}

export async function getUnsyncedEvents(limit: number = CONSTANTS.BATCH_MAX_SIZE): Promise<EventQueueItem[]> {
  return db.events.where("synced").equals(0).limit(limit).toArray();
}

export async function markEventsSynced(ids: number[]): Promise<void> {
  await db.events.where("id").anyOf(ids).modify({ synced: true });
}

export async function removeSyncedEvents(): Promise<number> {
  return db.events.where("synced").equals(1).delete();
}

export async function retryFailedEvents(): Promise<void> {
  const failed = await db.events
    .where("synced")
    .equals(0)
    .and((e: EventQueueItem) => e.retryCount >= 3)
    .toArray();

  for (const item of failed) {
    await db.events.update(item.id!, { retryCount: item.retryCount + 1 });
  }
}

// ============================================================
// Pending Messages Queue
// ============================================================

export async function enqueueMessage(msg: {
  messageId: string;
  chatId: string;
  text?: string;
  media?: string;
}): Promise<number> {
  return db.pendingMessages.add({
    messageId: msg.messageId,
    chatId: msg.chatId,
    text: msg.text,
    media: msg.media,
    status: "pending",
    createdAt: Date.now(),
    retryCount: 0,
  });
}

export async function updateMessageStatus(
  id: number,
  status: PendingMessage["status"],
  error?: string
): Promise<void> {
  const update: Partial<PendingMessage> = { status };
  if (status === "sent") update.sentAt = Date.now();
  if (error) update.error = error;
  await db.pendingMessages.update(id, update);
}

export async function getPendingMessages(): Promise<PendingMessage[]> {
  return db.pendingMessages.where("status").anyOf(["pending", "failed"]).toArray();
}

// ============================================================
// Cache
// ============================================================

export async function setCache(key: string, value: any, ttlMs = 300000): Promise<void> {
  await db.cache.put({
    key,
    value,
    expiresAt: Date.now() + ttlMs,
    createdAt: Date.now(),
  });
}

export async function getCache<T = any>(key: string): Promise<T | null> {
  const entry = await db.cache.where("key").equals(key).first();
  if (!entry) return null;
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    await db.cache.delete(entry.id!);
    return null;
  }
  return entry.value as T;
}

export async function clearExpiredCache(): Promise<number> {
  return db.cache.where("expiresAt").below(Date.now()).delete();
}

// ============================================================
// Session
// ============================================================

export async function saveSession(session: SessionInfo): Promise<void> {
  await db.sessions.put(session);
}

export async function getActiveSession(): Promise<SessionInfo | undefined> {
  return db.sessions.where("isReady").equals(1).first();
}

export async function updateSessionHeartbeat(sessionId: string): Promise<void> {
  await db.sessions.where("sessionId").equals(sessionId).modify({
    lastHeartbeat: Date.now(),
  });
}

export async function removeSession(sessionId: string): Promise<void> {
  await db.sessions.where("sessionId").equals(sessionId).delete();
}

// ============================================================
// Contacts & Chats
// ============================================================

export async function upsertContact(contact: WAContact): Promise<void> {
  await db.contacts.put(contact);
}

export async function getContact(contactId: string): Promise<WAContact | undefined> {
  return db.contacts.where("contactId").equals(contactId).first();
}

export async function upsertChat(chat: WAChat): Promise<void> {
  await db.chats.put(chat);
}

export async function getChat(chatId: string): Promise<WAChat | undefined> {
  return db.chats.where("chatId").equals(chatId).first();
}

export async function getChatList(): Promise<WAChat[]> {
  return db.chats.toArray();
}
