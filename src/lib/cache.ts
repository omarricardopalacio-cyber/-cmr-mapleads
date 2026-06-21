type CacheEntry<T> = { value: T; expiresAt: number };
const store = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function cacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export async function withCache<T>(
  key: string,
  fetch: () => Promise<T>,
  ttlMs: number = 300_000,
): Promise<T> {
  const cached = cacheGet<T>(key);
  if (cached !== undefined) return cached;
  const value = await fetch();
  if (value !== null && value !== undefined) {
    cacheSet(key, value, ttlMs);
  }
  return value;
}

export function clearCache(): void {
  store.clear();
}
