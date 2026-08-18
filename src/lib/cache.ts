/**
 * Tiny in-memory TTL cache to cut down on Google Sheets API calls (60 req/min/user quota)
 * and to make dashboards feel fast. Lives per warm serverless instance only — not shared
 * across Vercel instances — so keep TTLs short (seconds, not minutes) for anything that
 * must reflect writes quickly.
 */
type CacheEntry<T> = { value: T; expiresAt: number };

const store = new Map<string, CacheEntry<unknown>>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value as T;
  }
  const value = await fn();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

export function invalidateCache(key: string): void {
  store.delete(key);
}
