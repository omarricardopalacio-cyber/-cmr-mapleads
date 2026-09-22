// Qué se manda a /ingest y qué muestra el Debug.
// Un shell vacío no puede marcar el waMessageId como visto: el cuerpo con
// emojis llega un instante después y el CRM se queda sin fila.

import { hasVisibleMessageText } from "./message-text.ts";
import { canonicalWaId, isLidJid } from "./wa-identity.ts";

const MEDIA_TYPES = new Set(["image", "video", "audio", "ptt", "document", "sticker"]);

export type SeenStamp = { at: number; text: string; posted: boolean };

export function isLiveChatEvent(type: unknown): boolean {
  const raw = String(type || "");
  return (
    raw === "NEW_MESSAGE" ||
    raw === "MESSAGE_SENT" ||
    raw === "message-in" ||
    raw === "message-out"
  );
}

export function payloadHasIngestableMedia(media: unknown): boolean {
  if (!media || typeof media !== "object") return false;
  const record = media as Record<string, unknown>;
  if (record.localOnly === true || record.missing_media === true) return true;
  const url = record.url;
  if (typeof url === "string" && /^https?:\/\//i.test(url)) return true;
  const inline = record.base64 || record.body || record.data;
  if (typeof inline === "string" && inline.length > 64) return true;
  const type = String(record.type || record.mimetype || "");
  if (MEDIA_TYPES.has(type)) return true;
  if (type.startsWith("image/") || type.startsWith("audio/") || type.startsWith("video/")) return true;
  return false;
}

/** Hay algo que el CRM puede guardar (texto, emojis o media). */
export function chatEventIsPostable(opts: {
  type: unknown;
  text?: unknown;
  media?: unknown;
}): boolean {
  if (!isLiveChatEvent(opts.type)) return true;
  const text = typeof opts.text === "string" ? opts.text : opts.text == null ? "" : String(opts.text);
  if (hasVisibleMessageText(text)) return true;
  if (payloadHasIngestableMedia(opts.media)) return true;
  const mediaType = String((opts.media as { type?: string } | undefined)?.type || "");
  if (MEDIA_TYPES.has(mediaType)) return true;
  return false;
}

export function readSeenStamp(raw: unknown): SeenStamp | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return { at: raw, text: "", posted: true };
  }
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const at = Number(record.at || 0);
  if (!Number.isFinite(at) || at <= 0) return null;
  return {
    at,
    text: typeof record.text === "string" ? record.text : "",
    posted: record.posted !== false,
  };
}

/**
 * true = no volver a encolar.
 * Un visto previo sin texto no bloquea el mismo id cuando ya trae emojis.
 */
export function shouldSkipDuplicateIngest(opts: {
  previous: unknown;
  nextText: string;
  now: number;
  windowMs?: number;
}): boolean {
  const prev = readSeenStamp(opts.previous);
  if (!prev) return false;
  const windowMs = opts.windowMs ?? 90_000;
  if (opts.now - prev.at >= windowMs) return false;
  if (hasVisibleMessageText(opts.nextText) && !hasVisibleMessageText(prev.text)) return false;
  return true;
}

/** JID que el CRM puede usar. `unknown` y un string vacío no cuentan. */
export function usableChatId(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const raw = candidate.trim();
    if (!raw || raw.toLowerCase() === "unknown") continue;
    const canonical = canonicalWaId(raw);
    if (canonical) return canonical;
    if (isLidJid(raw)) return raw;
  }
  return undefined;
}

export function clipIngestString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  return value.length <= max ? value : value.slice(0, max);
}

/** Recorta un JID sin perder `@lid` / `@c.us` (un 400 de Zod tumba el lote). */
export function clipJid(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  if (value.length <= max) return value;
  const at = value.lastIndexOf("@");
  if (at > 0) {
    const domain = value.slice(at);
    const room = max - domain.length;
    if (room >= 4) return value.slice(0, room) + domain;
  }
  return value.slice(0, max);
}

export function ingestBodySnippet(body: string, max = 180): string {
  return (body || "").replace(/\s+/g, " ").trim().slice(0, max);
}
