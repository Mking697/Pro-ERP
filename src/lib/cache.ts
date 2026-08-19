/**
 * Tiny in-memory TTL cache to cut down on Google Sheets API calls and to make
 * dashboards feel fast. Lives per warm serverless instance only — not shared across
 * Vercel instances — so keep TTLs short for anything that must reflect writes quickly.
 *
 * MULTI-TENANT SAFETY: a warm instance serves requests from many organizations, so an
 * un-scoped key would hand one org's cached Settings (its sheet IDs, its ChatXFlow API
 * token) to the next org that asks for it. Tenant data must go through `tenantCached`,
 * which prefixes the key with the org ID; plain `cached` is only for genuinely global
 * values like the platform registry.
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

/** Scopes a cache key to one organization. Use for anything read out of a tenant's sheets. */
export async function tenantCached<T>(
  orgId: string,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T> {
  return cached(`org:${orgId}|${key}`, ttlMs, fn);
}

export function invalidateTenantCache(orgId: string, key: string): void {
  store.delete(`org:${orgId}|${key}`);
}

/** Drops every cached entry for one organization — used when its connections change. */
export function invalidateOrg(orgId: string): void {
  const prefix = `org:${orgId}|`;
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
