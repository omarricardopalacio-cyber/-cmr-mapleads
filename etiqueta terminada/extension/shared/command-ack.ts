// ACK de engine_commands hacia /api/public/engine/ingest.
//
// El CRM marca el comando `delivered` al entregarlo por GET. `acked_at` solo
// se escribe cuando ingest recibe type=ack con commandId (uuid), ackStatus
// `ok` | `error` y payload.result.messageId / payload.error.
// Un ACK sin chatId lo descartaba el ingest antes de esa rama (`if (!waId) continue`).

import { canonicalWaId, isCusJid, sanitizePhoneForIngest } from "./wa-identity.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCommandUuid(id: unknown): id is string {
  return typeof id === "string" && UUID_RE.test(id.trim());
}

/** Espera del content script. El sender de texto puede reintentar ~132s; media, ~8 min. */
export function commandWaitMs(event: string | undefined): number {
  const cmd = String(event || "").toUpperCase().replace(/-/g, "_");
  if (cmd === "GET_CHAT_LIST" || cmd === "GET_CHAT_MESSAGES" || cmd === "GET_CONTACT_LIST") {
    return 120_000;
  }
  if (cmd === "SEND_MEDIA") return 540_000;
  if (cmd === "SEND_MESSAGE" || cmd === "SEND_BROADCAST") return 150_000;
  return 15_000;
}

export type CommandAckStatus = "ok" | "error";

export interface InterpretedCommandResult {
  ok: boolean;
  ackStatus: CommandAckStatus;
  error?: string;
  messageId?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** `{ error }` es fallo. Sin respuesta también. Un envío ok trae messageId y/o sent:true. */
export function interpretCommandResult(result: unknown): InterpretedCommandResult {
  const record = asRecord(result);
  if (!record) {
    return { ok: false, ackStatus: "error", error: "empty_command_response" };
  }
  const nested = asRecord(record.payload);
  const error = firstString(record.error, nested?.error);
  if (error) return { ok: false, ackStatus: "error", error };
  if (record.sent === false || nested?.sent === false) {
    return { ok: false, ackStatus: "error", error: "send_not_confirmed" };
  }
  const messageId = firstString(
    record.messageId,
    record.waMessageId,
    nested?.messageId,
    nested?.waMessageId,
  );
  return { ok: true, ackStatus: "ok", messageId };
}

export interface CommandChatIdentity {
  chatId?: string;
  phone?: string;
  contact?: { waId: string; phone?: string };
}

export function commandChatIdentity(payload: Record<string, unknown> | null | undefined): CommandChatIdentity {
  const raw = payload?.chatId ?? payload?.to ?? payload?.waId;
  const chatId = canonicalWaId(raw);
  if (!chatId) return {};
  const verifiedCus = isCusJid(chatId);
  const phone = sanitizePhoneForIngest(
    verifiedCus ? chatId : payload?.phone,
    chatId,
    { verifiedCus },
  );
  return {
    chatId,
    phone,
    contact: phone ? { waId: chatId, phone } : { waId: chatId },
  };
}

export function outboundCommandText(payload: Record<string, unknown> | null | undefined): string | undefined {
  return firstString(payload?.text, payload?.body, payload?.caption, payload?.message);
}

export interface AckIngestEvent {
  id: string;
  type: "ack" | "message-out";
  commandId?: string;
  ackStatus?: CommandAckStatus;
  chatId?: string;
  waMessageId?: string;
  direction?: "out";
  text?: string;
  contact?: { waId: string; phone?: string };
  sentAt?: number;
  media?: { type: string };
  payload: Record<string, unknown>;
  timestamp: number;
}

export function buildCommandIngestEvents(input: {
  commandId: string;
  commandType?: string;
  payload?: Record<string, unknown> | null;
  result: unknown;
  now?: number;
}): AckIngestEvent[] {
  const now = input.now ?? Date.now();
  const interpreted = interpretCommandResult(input.result);
  const identity = commandChatIdentity(input.payload);
  const commandId = isCommandUuid(input.commandId) ? input.commandId.trim() : undefined;
  const text = outboundCommandText(input.payload);
  const commandType = String(input.commandType || "").toUpperCase().replace(/-/g, "_");
  const isSend = commandType === "SEND_MESSAGE" || commandType === "SEND_MEDIA";

  const ackPayload: Record<string, unknown> = {
    commandId,
    commandType,
    status: interpreted.ackStatus,
    executedAt: now,
    chatId: identity.chatId,
    text,
  };
  if (interpreted.ok) {
    const result: Record<string, unknown> = {};
    if (interpreted.messageId) result.messageId = interpreted.messageId;
    if (isSend) result.sent = true;
    if (Object.keys(result).length > 0) ackPayload.result = result;
  } else {
    ackPayload.error = interpreted.error;
  }

  const events: AckIngestEvent[] = [
    {
      id: `ack-${input.commandId}-${now}`,
      type: "ack",
      commandId,
      ackStatus: interpreted.ackStatus,
      chatId: identity.chatId,
      contact: identity.contact,
      payload: ackPayload,
      timestamp: now,
    },
  ];

  if (interpreted.ok && isSend && identity.chatId && (text || interpreted.messageId)) {
    const mediaType = text
      ? undefined
      : firstString(input.payload?.mimeType, input.payload?.mime_type, "file");
    events.push({
      id: `out-${input.commandId}-${now}`,
      type: "message-out",
      commandId,
      chatId: identity.chatId,
      waMessageId: interpreted.messageId,
      direction: "out",
      text,
      contact: identity.contact,
      sentAt: now,
      timestamp: now,
      media: mediaType ? { type: mediaType } : undefined,
      payload: {
        fromMe: true,
        direction: "out",
        chatId: identity.chatId,
        text,
        commandId,
        messageId: interpreted.messageId,
      },
    });
  }

  return events;
}
