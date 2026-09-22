// Mensajes en vivo: fromMe real, peer (no nuestro número) y filtro de historial.

import { digitsOnly, isGroupJid } from "./wa-identity.ts";

const SKIP_TYPES = new Set([
  "notification",
  "notification_template",
  "e2e_notification",
  "gp2",
  "ciphertext",
  "protocol",
  "call_log",
  "revoked",
  "reaction",
  "broadcast_notification",
  "group_notification",
]);

export function isSkippableWaType(type: unknown): boolean {
  return SKIP_TYPES.has(String(type || "").toLowerCase());
}

/** Solo `true` real es saliente. El string `"false"` no cuenta. */
export function coerceFromMe(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (value === true || value === 1 || value === "true" || value === "1") return true;
    if (value === false || value === 0 || value === "false" || value === "0") return false;
  }
  return undefined;
}

export function samePhone(jid: unknown, meDigits: string | undefined): boolean {
  if (!meDigits) return false;
  const digits = digitsOnly(jid);
  return !!digits && digits === meDigits;
}

/**
 * El chat es `id.remote`. `from` en un entrante LID a veces somos nosotros;
 * usar eso como chatId hacía que el CRM descartara el mensaje.
 */
export function peerChatJid(opts: {
  remote?: unknown;
  from?: unknown;
  to?: unknown;
  meDigits?: string;
}): string {
  const remote = typeof opts.remote === "string" ? opts.remote.trim() : "";
  if (remote && !isGroupJid(remote) && !samePhone(remote, opts.meDigits)) return remote;
  const alts = [opts.from, opts.to];
  for (const alt of alts) {
    if (typeof alt !== "string" || !alt.trim()) continue;
    if (isGroupJid(alt)) continue;
    if (samePhone(alt, opts.meDigits)) continue;
    return alt.trim();
  }
  return remote;
}

/**
 * El store de WhatsApp agrega historial con isNewMsg=false.
 * `chat.new_message` no dispara; igual hay que tomar lo reciente.
 */
export function shouldIngestLiveMessage(opts: {
  messageId?: string;
  type?: string;
  timestampSec?: number;
  nowMs: number;
  catchupSinceMs: number;
  /** `add` sin timestamp sigue siendo un mensaje que acaba de entrar. */
  allowMissingTimestamp?: boolean;
}): boolean {
  if (!opts.messageId) return false;
  if (isSkippableWaType(opts.type)) return false;
  const sec = Number(opts.timestampSec || 0);
  if (!sec) return !!opts.allowMissingTimestamp;
  const ms = sec < 1e12 ? sec * 1000 : sec;
  if (ms < opts.catchupSinceMs) return false;
  if (ms > opts.nowMs + 120_000) return false;
  return true;
}
