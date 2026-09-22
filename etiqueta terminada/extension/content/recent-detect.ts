// El content script recuerda peers ya emitidos por WPP para no duplicar la lista.
// Un aviso sin texto (el store aún no hidrata el cuerpo) no tapa el preview con emojis.

import { hasVisibleMessageText } from "../shared/message-text.ts";

type Hit = { at: number; text: string };

const recent = new Map<string, Hit>();

function remember(value: unknown, now: number, text: string): void {
  if (value == null) return;
  const key = String(value).trim();
  if (!key) return;
  const visible = hasVisibleMessageText(text) ? text.trim().slice(0, 80) : "";
  const prev = recent.get(key);
  recent.set(key, { at: now, text: visible || prev?.text || "" });
  const digits = key.split("@")[0].replace(/\D/g, "");
  if (digits.length >= 8) {
    const prevDigits = recent.get(digits);
    recent.set(digits, { at: now, text: visible || prevDigits?.text || "" });
  }
}

export function noteDetectedPeer(ids: unknown[], now = Date.now(), text = ""): void {
  for (const id of ids) remember(id, now, text);
}

function recentHit(id: unknown, withinMs: number, now: number): Hit | undefined {
  if (id == null) return undefined;
  const key = String(id).trim();
  const digits = key.split("@")[0].replace(/\D/g, "");
  const hits = [recent.get(key), digits ? recent.get(digits) : undefined];
  return hits.find((hit) => !!hit && now - hit.at < withinMs);
}

/** Texto ya emitido para ese peer, o "" si no hay uno reciente. */
export function recentPeerText(id: unknown, withinMs = 8_000, now = Date.now()): string {
  return recentHit(id, withinMs, now)?.text || "";
}

/** true solo si el peer reciente ya salió con texto visible (emojis incluidos). */
export function wasRecentlyDetected(id: unknown, withinMs = 8_000, now = Date.now()): boolean {
  return hasVisibleMessageText(recentPeerText(id, withinMs, now));
}
