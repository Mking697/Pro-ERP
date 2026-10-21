import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { userSettings } from "@/db/schema";
import { getTenantOrgId } from "@/lib/tenant";

/**
 * Per-(org, user) key-value settings — mirrors src/lib/settings.ts's per-org version,
 * minus its request-scoped memoization: these are read once per Server Component render
 * (today: once, on /dashboard, for the widget layout) rather than from several call
 * sites in the same request, so the extra cache plumbing has no payoff here yet. Add it
 * the same way settings.ts did if a second caller in the same request ever needs it.
 */
export async function getUserSetting(userId: string, key: string): Promise<string | null> {
  const orgId = await getTenantOrgId();
  const [row] = await db
    .select({ value: userSettings.value })
    .from(userSettings)
    .where(
      and(
        eq(userSettings.orgId, orgId),
        eq(userSettings.userId, userId),
        eq(userSettings.key, key)
      )
    )
    .limit(1);
  return row?.value ?? null;
}

/** Inserts a (user, key) row if it does not exist yet, otherwise updates it in place. */
export async function upsertUserSetting(userId: string, key: string, value: string): Promise<void> {
  const orgId = await getTenantOrgId();
  await db
    .insert(userSettings)
    .values({ orgId, userId, key, value })
    .onConflictDoUpdate({
      target: [userSettings.orgId, userSettings.userId, userSettings.key],
      set: { value },
    });
}
