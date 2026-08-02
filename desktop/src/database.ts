import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { EngineCommand, IngestResult, JsonRecord, RecentMessage } from "./types.js";

const now = () => new Date().toISOString();

export class PilotDatabase {
  readonly db: Database.Database;

  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close() {
    this.db.close();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `);
    const applied = this.db.prepare("SELECT version FROM schema_migrations WHERE version = 1").get();
    if (applied) return;

    const applyVersionOne = this.db.transaction(() => {
      this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        wa_id TEXT NOT NULL UNIQUE,
        phone TEXT,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL REFERENCES contacts(id),
        chat_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_message_at TEXT
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id),
        wa_message_id TEXT,
        event_key TEXT NOT NULL UNIQUE,
        direction TEXT NOT NULL CHECK(direction IN ('in', 'out')),
        text TEXT NOT NULL,
        raw_json TEXT,
        sent_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(thread_id, wa_message_id)
      );
      CREATE TABLE IF NOT EXISTS engine_commands (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'delivered', 'acked', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        acknowledged_at TEXT,
        result_json TEXT
      );
      CREATE INDEX IF NOT EXISTS engine_commands_claim_idx ON engine_commands(status, created_at);
      CREATE INDEX IF NOT EXISTS messages_thread_sent_idx ON messages(thread_id, sent_at DESC);
    `);
      this.db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(1, ?)").run(now());
    });
    applyVersionOne();
  }

  getOrCreateToken(): string {
    const existing = this.db.prepare("SELECT value FROM settings WHERE key = 'session_token'").get() as
      | { value: string }
      | undefined;
    if (existing) return existing.value;
    const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    this.db.prepare("INSERT INTO settings(key, value, updated_at) VALUES('session_token', ?, ?)").run(token, now());
    return token;
  }

  recordHeartbeat(payload: JsonRecord) {
    this.setSetting("last_heartbeat", JSON.stringify({ ...payload, receivedAt: now() }));
  }

  private setSetting(key: string, value: string) {
    this.db
      .prepare(`
        INSERT INTO settings(key, value, updated_at) VALUES(?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `)
      .run(key, value, now());
  }

  ingest(payload: JsonRecord): IngestResult {
    const events = Array.isArray(payload.events) ? payload.events : [];
    const transaction = this.db.transaction(() => {
      let inserted = 0;
      let duplicates = 0;
      let acknowledgedCommands = 0;

      for (const rawEvent of events) {
        if (!rawEvent || typeof rawEvent !== "object") continue;
        const event = rawEvent as JsonRecord;
        const type = String(event.type ?? "");
        const eventPayload = { ...event, ...(isRecord(event.payload) ? event.payload : {}) };
        if (type === "MESSAGE_ACK" || type === "MESSAGE_SENT" || type === "MESSAGE_FAILED" || type === "ack") {
          const commandId = stringValue(eventPayload.commandId ?? eventPayload.command_id);
          if (commandId) acknowledgedCommands += this.acknowledgeCommand(commandId, type, eventPayload);
        }
        if (!["NEW_MESSAGE", "MESSAGE_SENT", "message-in", "message-out"].includes(type)) continue;

        const message = normaliseMessage(event, eventPayload);
        if (!message) continue;
        const exists = this.db.prepare("SELECT id FROM messages WHERE event_key = ?").get(message.eventKey);
        if (exists) {
          duplicates++;
          continue;
        }

        const contact = this.resolveContact(message);
        const thread = this.resolveThread(contact.id, message.chatId);
        try {
          this.db
            .prepare(`
              INSERT INTO messages(id, thread_id, wa_message_id, event_key, direction, text, raw_json, sent_at, created_at)
              VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
            `)
            .run(randomUUID(), thread.id, message.waMessageId, message.eventKey, message.direction, message.text,
              JSON.stringify(event), message.sentAt, now());
          this.db.prepare("UPDATE threads SET updated_at = ?, last_message_at = ? WHERE id = ?")
            .run(now(), message.sentAt, thread.id);
          inserted++;
        } catch (error) {
          if (isSqliteUnique(error)) duplicates++;
          else throw error;
        }
      }
      return { inserted, duplicates, acknowledgedCommands };
    });
    return transaction();
  }

  private resolveContact(message: NormalisedMessage) {
    const existing = this.db.prepare("SELECT id FROM contacts WHERE wa_id = ?").get(message.contactWaId) as { id: string } | undefined;
    if (existing) return existing;
    const id = randomUUID();
    const timestamp = now();
    this.db.prepare(`
      INSERT INTO contacts(id, wa_id, phone, display_name, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?)
    `).run(id, message.contactWaId, phoneFromWaId(message.contactWaId), message.contactName, timestamp, timestamp);
    return { id };
  }

  private resolveThread(contactId: string, chatId: string) {
    const existing = this.db.prepare("SELECT id FROM threads WHERE chat_id = ?").get(chatId) as { id: string } | undefined;
    if (existing) return existing;
    const id = randomUUID();
    const timestamp = now();
    this.db.prepare("INSERT INTO threads(id, contact_id, chat_id, created_at, updated_at) VALUES(?, ?, ?, ?, ?)")
      .run(id, contactId, chatId, timestamp, timestamp);
    return { id };
  }

  enqueueCommand(type: string, payload: JsonRecord): EngineCommand {
    const command: EngineCommand = { id: randomUUID(), type, payload, attempts: 0, createdAt: now() };
    this.db.prepare(`
      INSERT INTO engine_commands(id, type, payload_json, status, attempts, created_at)
      VALUES(?, ?, ?, 'pending', 0, ?)
    `).run(command.id, command.type, JSON.stringify(command.payload), command.createdAt);
    return command;
  }

  claimCommands(limit = 10): EngineCommand[] {
    const claim = this.db.transaction(() => {
      const rows = this.db.prepare(`
        SELECT id, type, payload_json, attempts, created_at
        FROM engine_commands WHERE status = 'pending'
        ORDER BY created_at ASC LIMIT ?
      `).all(limit) as Array<{ id: string; type: string; payload_json: string; attempts: number; created_at: string }>;
      if (!rows.length) return [];
      const claimedAt = now();
      const update = this.db.prepare(`
        UPDATE engine_commands
        SET status = 'delivered', attempts = attempts + 1, delivered_at = ?
        WHERE id = ? AND status = 'pending'
      `);
      const claimed = rows.filter((row) => update.run(claimedAt, row.id).changes === 1);
      return claimed.map((row) => ({
        id: row.id, type: row.type, payload: JSON.parse(row.payload_json) as JsonRecord,
        attempts: row.attempts + 1, createdAt: row.created_at,
      }));
    });
    return claim();
  }

  acknowledgeCommand(id: string, eventType: string, result: JsonRecord): number {
    const status = eventType === "MESSAGE_FAILED" || (eventType === "ack" && result.status === "error") ? "failed" : "acked";
    return this.db.prepare(`
      UPDATE engine_commands SET status = ?, acknowledged_at = ?, result_json = ?
      WHERE id = ? AND status = 'delivered'
    `).run(status, now(), JSON.stringify(result), id).changes;
  }

  recentMessages(limit = 30): RecentMessage[] {
    return this.db.prepare(`
      SELECT m.id, m.wa_message_id AS waMessageId, m.direction, m.text, m.sent_at AS sentAt,
             c.display_name AS contactName, t.chat_id AS chatId
      FROM messages m
      JOIN threads t ON t.id = m.thread_id
      JOIN contacts c ON c.id = t.contact_id
      ORDER BY m.sent_at DESC LIMIT ?
    `).all(limit) as RecentMessage[];
  }
}

interface NormalisedMessage {
  eventKey: string; waMessageId: string | null; chatId: string; contactWaId: string;
  contactName: string; direction: "in" | "out"; text: string; sentAt: string;
}

function normaliseMessage(event: JsonRecord, payload: JsonRecord): NormalisedMessage | null {
  const messageId = stringValue(payload.messageId ?? payload.waMessageId ?? payload.id);
  const contact = isRecord(payload.contact) ? payload.contact : {};
  const chatId = stringValue(payload.chatId ?? payload.from ?? payload.to);
  const text = stringValue(payload.body ?? payload.text);
  if (!chatId || !text) return null;
  const fromMe = payload.fromMe === true || payload.direction === "out" || event.type === "MESSAGE_SENT" || event.type === "message-out";
  const contactWaId = stringValue(fromMe ? payload.to : payload.from) ?? stringValue(contact.waId) ?? chatId;
  const timestamp = isoTimestamp(payload.sentAt ?? payload.timestamp ?? event.timestamp);
  return {
    eventKey: stringValue(event.id) ?? messageId ?? `${chatId}:${fromMe ? "out" : "in"}:${timestamp}:${text.slice(0, 80)}`,
    waMessageId: messageId, chatId, contactWaId,
    contactName: stringValue(contact.displayName ?? payload.pushname ?? payload.displayName ?? payload.name) ?? contactWaId.split("@")[0],
    direction: fromMe ? "out" : "in", text, sentAt: timestamp,
  };
}

function isoTimestamp(value: unknown): string {
  const date = typeof value === "number" ? new Date(value < 1e12 ? value * 1000 : value) : new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? now() : date.toISOString();
}
function isRecord(value: unknown): value is JsonRecord { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function stringValue(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function phoneFromWaId(waId: string): string | null { const digits = waId.split("@")[0].replace(/\D/g, ""); return digits || null; }
function isSqliteUnique(error: unknown) { return error instanceof Error && /UNIQUE constraint failed/.test(error.message); }
