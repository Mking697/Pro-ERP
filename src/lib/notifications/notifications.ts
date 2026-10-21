import { and, desc, eq } from "drizzle-orm";
import { inArray } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { db } from "@/db/client";
import { notifications } from "@/db/schema";
import { getTenantOrgId } from "@/lib/tenant";

/**
 * User-facing notification read/write — separate from src/lib/notifications/dispatch.ts
 * (which writes rows FROM domain events; this file only ever reads/mutates rows that
 * already exist, on behalf of the signed-in user who owns them).
 *
 * Every function here is org-scoped AND userId-scoped, never org_id alone — mirrors
 * src/lib/savedViews.ts's own "a saved view never leaks across users in the same org"
 * discipline exactly: a notification is private to whoever it was addressed to, the same
 * way a saved view is private to whoever created it.
 */
export interface NotificationRecord {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  isRead: boolean;
  createdAt: string;
}

type NotificationRow = InferSelectModel<typeof notifications>;

function toRecord(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    isRead: row.isRead,
    createdAt: row.createdAt.toISOString(),
  };
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function listMyNotifications(
  userId: string,
  options?: { unreadOnly?: boolean; limit?: number }
): Promise<NotificationRecord[]> {
  const orgId = await getTenantOrgId();
  const limit = Math.min(Math.max(1, options?.limit ?? DEFAULT_LIMIT), MAX_LIMIT);

  const conditions = [eq(notifications.orgId, orgId), eq(notifications.userId, userId)];
  if (options?.unreadOnly) {
    conditions.push(eq(notifications.isRead, false));
  }

  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return rows.map(toRecord);
}

/** Cheap COUNT for the bell badge — never fetches the rows themselves. */
export async function countUnreadNotifications(userId: string): Promise<number> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        eq(notifications.orgId, orgId),
        eq(notifications.userId, userId),
        eq(notifications.isRead, false)
      )
    );
  return rows.length;
}

/** Marks exactly the given ids read, scoped to (orgId, userId) — a caller can never mark
 * another user's notification read by guessing its id, since the WHERE clause only ever
 * matches rows that are both this org's AND this user's. */
export async function markNotificationsRead(userId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const orgId = await getTenantOrgId();
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.orgId, orgId),
        eq(notifications.userId, userId),
        inArray(notifications.id, ids)
      )
    );
}

/** Marks every one of this user's currently-unread rows read. */
export async function markAllNotificationsRead(userId: string): Promise<void> {
  const orgId = await getTenantOrgId();
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.orgId, orgId),
        eq(notifications.userId, userId),
        eq(notifications.isRead, false)
      )
    );
}
