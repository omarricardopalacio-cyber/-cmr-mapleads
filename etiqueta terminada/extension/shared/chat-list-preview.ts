// Fila de la lista de WhatsApp Web (el chat no tiene que estar abierto).

import { canonicalWaId, isGroupJid, looksLikeLidDigits } from "./wa-identity.ts";

export type ListRowSnapshot = {
  key: string;
  chatId: string;
  phone?: string;
  lid?: string;
  text: string;
  direction: "in" | "out";
  timeLabel: string;
  unread: number;
  sentAt?: string;
};

const CLOCK_RE = /^(\d{1,2}):(\d{2})\b/;

export function isClockLabel(value: string): boolean {
  return CLOCK_RE.test(value.trim());
}

export function phoneFromLabel(value: string): string | null {
  const text = value.trim();
  if (!text || text.includes("@")) return null;
  const plus = text.match(/\+\s*(\d[\d\s-]{8,18})/);
  const plain = text.match(/\b(\d{10,13})\b/);
  const raw = (plus?.[1] || plain?.[1] || "").replace(/\D/g, "");
  if (raw.length < 10 || raw.length > 13) return null;
  if (looksLikeLidDigits(raw)) return null;
  return raw;
}

export function jidFromSnippet(html: string): { lid?: string; chatId?: string } {
  const match = html.match(/(\d{5,}@(?:lid|c\.us|s\.whatsapp\.net|g\.us))/i);
  if (!match?.[1]) return {};
  const jid = match[1].toLowerCase();
  if (jid.endsWith("@lid")) return { lid: jid, chatId: jid };
  return { chatId: jid };
}

export function sentAtFromClockLabel(label: string, now = new Date()): string | undefined {
  const match = label.trim().match(/(\d{1,2}):(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?)?/i);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59 || hour > 23) return undefined;
  const ap = (match[3] || "").toLowerCase().replace(/\./g, "").replace(/\s+/g, "");
  if (ap.startsWith("p") && hour < 12) hour += 12;
  if (ap.startsWith("a") && hour === 12) hour = 0;
  if (!ap && hour > 23) return undefined;
  const stamp = new Date(now);
  stamp.setHours(hour, minute, 0, 0);
  if (stamp.getTime() - now.getTime() > 5 * 60_000) {
    stamp.setDate(stamp.getDate() - 1);
  }
  return stamp.toISOString();
}

function unreadCount(unreadLabel: string, lines: string[]): number {
  const fromAria = unreadLabel.match(/(\d{1,4})/);
  if (fromAria) return Number(fromAria[1]);
  const badge = lines.find((line) => /^\d{1,2}$/.test(line.trim()));
  return badge ? Number(badge) : 0;
}

function pickPreview(titles: string[], lines: string[], phoneLine: string | undefined): string {
  const seen = new Set<string>();
  const candidates = [...titles, ...lines];
  for (const raw of candidates) {
    const text = raw.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    if (isClockLabel(text)) continue;
    if (/^\d{1,3}$/.test(text)) continue;
    if (phoneLine && text === phoneLine) continue;
    if (phoneFromLabel(text) && text === phoneLine) continue;
    if (phoneFromLabel(text) && !text.replace(/[\d+\s-]/g, "")) continue;
    return text;
  }
  return "";
}

export function snapshotFromRowParts(input: {
  titles: string[];
  lines: string[];
  htmlSnippet?: string;
  unreadLabel?: string;
  hasOutgoingTick?: boolean;
  now?: Date;
}): ListRowSnapshot | null {
  const titles = input.titles.map((t) => t.trim()).filter(Boolean);
  const lines = input.lines.map((t) => t.trim()).filter(Boolean);
  const jid = jidFromSnippet(input.htmlSnippet || "");
  if (jid.chatId && isGroupJid(jid.chatId)) return null;

  const phoneLine =
    titles.find((t) => phoneFromLabel(t)) || lines.find((t) => phoneFromLabel(t)) || undefined;
  const phone = phoneLine ? phoneFromLabel(phoneLine) || undefined : undefined;
  const text = pickPreview(titles, lines, phoneLine);
  if (!text) return null;

  const timeLabel = [...lines, ...titles].find((line) => isClockLabel(line)) || "";
  const unread = unreadCount(input.unreadLabel || "", lines);
  const direction: "in" | "out" = unread > 0 || !input.hasOutgoingTick ? "in" : "out";
  const chatId = phone ? `${phone}@c.us` : jid.chatId || "";
  if (!chatId) return null;

  const lid = jid.lid;
  const key = phone || lid || chatId;
  return {
    key,
    chatId: canonicalWaId(chatId) || chatId,
    phone,
    lid,
    text,
    direction,
    timeLabel,
    unread,
    sentAt: timeLabel ? sentAtFromClockLabel(timeLabel, input.now) : undefined,
  };
}

export function listRowSignature(row: ListRowSnapshot): string {
  return `${row.text}|${row.timeLabel}|${row.unread}|${row.direction}`;
}

const LIST_CATCHUP_MS = 30 * 60_000;

/** La hora de la fila es de hoy y cabe en la ventana de catch-up. */
export function isRecentListTime(sentAt: string | undefined, nowMs = Date.now(), maxAgeMs = LIST_CATCHUP_MS): boolean {
  if (!sentAt) return false;
  const t = Date.parse(sentAt);
  if (!Number.isFinite(t)) return false;
  return t <= nowMs + 5 * 60_000 && nowMs - t <= maxAgeMs;
}

/**
 * Primera pasada: no leídos de la última media hora (el badge verde).
 * Después: una fila nueva en la lista, o una fila cuyo preview/hora cambió.
 * Un no leído de ayer no se reinyecta al recargar la extensión.
 */
export function shouldEmitListRow(opts: {
  previous: string | undefined;
  next: string;
  primed: boolean;
  unread: number;
  sentAt?: string;
  nowMs?: number;
  maxAgeMs?: number;
}): boolean {
  if (!isRecentListTime(opts.sentAt, opts.nowMs ?? Date.now(), opts.maxAgeMs ?? LIST_CATCHUP_MS)) return false;
  if (!opts.primed) return opts.unread > 0;
  if (opts.previous === undefined) return true;
  return opts.previous !== opts.next;
}

export function listPreviewMessageId(row: ListRowSnapshot): string {
  const key = row.phone || row.lid || row.chatId;
  const text = row.text.replace(/\s+/g, " ").slice(0, 48);
  return `list:${key}:${row.timeLabel}:${text}`.slice(0, 120);
}
