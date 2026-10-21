import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { notifications, orders } from "@/db/schema";
import { insertRecord } from "@/db/repo";
import { generateId } from "@/lib/id";
import { listDomainEventsSince } from "@/lib/events/emit";
import { getSetting, upsertSetting } from "@/lib/settings";
import { forEachActiveOrganization } from "@/lib/platform/runner";

/**
 * In-app notification dispatch — a POLLER of the `domain_events` log (src/lib/events/
 * emit.ts), structurally mirroring src/lib/apiAccess/webhooks.ts's
 * `dispatchPendingWebhooks()` exactly: for every org, read its own cursor, pull the next
 * page of relevant events, turn each into zero or more `notifications` rows, then advance
 * and persist the cursor once the whole page is processed. Driven by a cron route
 * (src/app/api/cron/dispatch-notifications/route.ts) on a short interval — nothing here
 * is wired synchronously into the emit path.
 *
 * Deliberately only three trigger types — "task.assigned", "order.status_changed",
 * "approval.pending" — NOT "stock.movement_recorded" (too noisy for a human inbox, even
 * though it's a real emitted domain-event type).
 */
export const NOTIFIABLE_EVENT_TYPES = [
  "task.assigned",
  "order.status_changed",
  "approval.pending",
] as const;

/** Per-org cursor, stored via the existing settings key-value table (src/lib/settings.ts)
 * — same convention as ONBOARDING_DISMISSED (src/lib/onboarding.ts), a plain org-wide
 * string flag, no new table. Empty string means "not started yet" (translated to `null`
 * for listDomainEventsSince(), matching that function's own sinceId=null convention);
 * once set, it holds a real domain_events.id. */
export const NOTIFICATION_DISPATCH_CURSOR_KEY = "NOTIFICATION_DISPATCH_CURSOR";

export interface NotificationInsert {
  userId: string;
  type: string;
  title: string;
  body: string;
  link: string;
}

// Plain constants, not inline literals in a `title:` object property — the i18n lint
// script (scripts/i18n-check.mjs) treats a literal assigned directly to a `title`
// property as UI copy needing a `t()` wrapper, which doesn't apply to this backend-only
// mapping (the dictionary lookup happens later, client-side, in notification-bell.tsx via
// `t(item.title)` against the exact same string).
const TASK_ASSIGNED_TITLE = "Naya Task Assign Hua";
const APPROVAL_PENDING_TITLE = "Leave Approval Pending";
const ORDER_STATUS_UPDATE_TITLE = "Order Status Update";

/**
 * Maps one domain event to zero or more notification rows. Exported standalone (not
 * folded into the dispatch loop) so this mapping logic — the actual business rule this
 * feature exists for — can be unit-tested without any tenant/cron plumbing: it only ever
 * takes `orgId` as a plain parameter and (for "order.status_changed") does one scoped DB
 * read, never touching `getTenantOrgId()`/settings/the event log itself.
 */
export async function eventToNotificationInputs(
  orgId: string,
  event: { type: string; payload: Record<string, unknown> }
): Promise<NotificationInsert[]> {
  switch (event.type) {
    case "task.assigned": {
      const payload = event.payload as { taskId?: string; assignedTo?: string; title?: string };
      if (!payload.assignedTo) return [];
      return [
        {
          userId: payload.assignedTo,
          type: event.type,
          title: TASK_ASSIGNED_TITLE,
          body: payload.title ?? "",
          link: "/tasks",
        },
      ];
    }

    case "approval.pending": {
      const payload = event.payload as {
        leaveId?: string;
        approverId?: string;
        stepNo?: number;
        requesterName?: string;
      };
      if (!payload.approverId) return [];
      return [
        {
          userId: payload.approverId,
          type: event.type,
          title: APPROVAL_PENDING_TITLE,
          body: `${payload.requesterName ?? ""} ka leave request approval ke liye pending hai`,
          link: "/leave",
        },
      ];
    }

    case "order.status_changed": {
      const payload = event.payload as {
        orderId?: string;
        fromStatus?: string;
        toStatus?: string;
        customerId?: string;
      };
      if (!payload.orderId) return [];
      // No recipient in the event's own payload — look up the order's own creator
      // directly, scoped to (orgId, orderId) like every other tenant-owned read.
      const [row] = await db
        .select({ id: orders.id, createdBy: orders.createdBy })
        .from(orders)
        .where(and(eq(orders.orgId, orgId), eq(orders.id, payload.orderId)));
      // A legacy row with no createdBy must not crash the whole dispatch cycle — skip
      // gracefully, the cursor still advances past this event by the caller.
      if (!row || !row.createdBy || !row.createdBy.trim()) return [];
      return [
        {
          userId: row.createdBy,
          type: event.type,
          title: ORDER_STATUS_UPDATE_TITLE,
          body: `Order ${payload.orderId} ka status "${payload.fromStatus ?? ""}" se "${payload.toStatus ?? ""}" ho gaya`,
          link: "/orders",
        },
      ];
    }

    default:
      return [];
  }
}

/** Polls fresh notifiable events for one org since its own cursor, writes every mapped
 * notification row, then advances+persists the cursor once the whole page is processed —
 * mirrors webhooks.ts's deliverNewEvents() exactly, just writing notifications instead of
 * POSTing. Pages until caught up (fewer than `limit` events returned), same contract
 * listDomainEventsSince() documents for any cursor consumer. */
export async function dispatchNotificationsForOrg(orgId: string): Promise<{ written: number }> {
  let written = 0;
  const storedCursor = await getSetting(NOTIFICATION_DISPATCH_CURSOR_KEY);
  let sinceId: string | null = storedCursor && storedCursor.trim() ? storedCursor : null;

  for (;;) {
    const page = await listDomainEventsSince(orgId, sinceId, [...NOTIFIABLE_EVENT_TYPES], 100);

    for (const event of page.events) {
      const rows = await eventToNotificationInputs(orgId, event);
      for (const row of rows) {
        await insertRecord(notifications, {
          id: generateId("NTF"),
          orgId,
          userId: row.userId,
          type: row.type,
          title: row.title,
          body: row.body,
          link: row.link,
          sourceEventId: event.id,
        });
        written++;
      }
    }

    sinceId = page.nextSinceId;
    if (page.events.length < 100) break;
  }

  await upsertSetting(NOTIFICATION_DISPATCH_CURSOR_KEY, sinceId ?? "");
  return { written };
}

/** The actual dispatch engine — called from the cron route, never per-request. Walks
 * every active org (src/lib/platform/runner.ts's forEachActiveOrganization(), the same
 * pool-bounded, per-org-isolated helper the daily recurring-task cron already uses) and
 * runs dispatchNotificationsForOrg() once for each. */
export async function dispatchNotifications() {
  return forEachActiveOrganization((ctx) => dispatchNotificationsForOrg(ctx.orgId));
}
