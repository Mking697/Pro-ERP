import { eq } from "drizzle-orm";
import { db, isInTenantTransaction } from "@/db/client";
import { settings } from "@/db/schema";
import { getTenantOrgId, getTenantRequestCache } from "@/lib/tenant";

/**
 * Reads the current organization's key-value settings using a request/operation-only
 * snapshot. Concurrent keys share one pending SQL read, never a global TTL. Explicit
 * tenant scopes and Server Component renders own independent snapshots; ordinary route
 * handlers need runWithTenant to opt in. Writes invalidate the snapshot immediately,
 * and transaction reads bypass it to preserve transaction visibility.
 */
export async function getAllSettings(): Promise<Record<string, string>> {
  const orgId = await getTenantOrgId();
  const scope = getTenantRequestCache();
  const key = `settings:${orgId}`;
  if (isInTenantTransaction()) {
    // READ COMMITTED and savepoint rollback require fresh transaction-visible reads.
    // Never retain a transaction snapshot after commit/rollback either.
    scope.delete(key);
    return readSettings(orgId);
  }
  let pending = scope.get(key) as Promise<Record<string, string>> | undefined;
  if (!pending) {
    pending = readSettings(orgId);
    scope.set(key, pending);
    // Failed reads must not poison retries in the same operation.
    void pending.catch(() => { if (scope.get(key) === pending) scope.delete(key); });
  }
  // Callers cannot mutate the shared snapshot.
  return { ...await pending };
}

async function readSettings(orgId: string): Promise<Record<string, string>> {
  const rows = await db.select().from(settings).where(eq(settings.orgId, orgId));
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}

export async function getSetting(key: string): Promise<string | null> {
  const all = await getAllSettings();
  return all[key] ?? null;
}

/** Inserts a key's row if it does not exist yet, otherwise updates it in place. */
export async function upsertSetting(key: string, value: string): Promise<void> {
  const orgId = await getTenantOrgId();
  await db
    .insert(settings)
    .values({ orgId, key, value })
    .onConflictDoUpdate({
      target: [settings.orgId, settings.key],
      set: { value },
    });
  getTenantRequestCache().delete(`settings:${orgId}`);
}
