// El content script recuerda peers ya emitidos por WPP para no duplicar la lista.

const recent = new Map<string, number>();

function remember(value: unknown, now: number): void {
  if (value == null) return;
  const text = String(value).trim();
  if (!text) return;
  recent.set(text, now);
  const digits = text.split("@")[0].replace(/\D/g, "");
  if (digits.length >= 8) recent.set(digits, now);
}

export function noteDetectedPeer(ids: unknown[], now = Date.now()): void {
  for (const id of ids) remember(id, now);
}

export function wasRecentlyDetected(id: unknown, withinMs = 8_000, now = Date.now()): boolean {
  if (id == null) return false;
  const text = String(id).trim();
  const digits = text.split("@")[0].replace(/\D/g, "");
  const stamps = [recent.get(text) || 0, digits ? recent.get(digits) || 0 : 0];
  return stamps.some((stamp) => stamp > 0 && now - stamp < withinMs);
}
