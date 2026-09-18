import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { settings } from "@/db/schema";
import { getTenantOrgId } from "@/lib/tenant";

/**
 * Reads the current organization's key-value Settings (connected sheet URLs, ChatXFlow
 * API token, IQC TAT defaults, etc.) — now a real `(org_id, key)`-indexed Postgres table
 * instead of a Sheets tab behind a 30s TTL cache. A real indexed read replaces the cache:
 * a warm serverless instance serving many tenants no longer risks handing one org's
 * settings to the next, and a write takes effect immediately instead of after up to 30s.
 */
export async function getAllSettings(): Promise<Record<string, string>> {
  const orgId = await getTenantOrgId();
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
}
