import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * In-app notification center (roadmap Phase B item #2) — a POLLER-written table, filled
 * by `src/lib/notifications/dispatch.ts`'s `dispatchNotifications()` reading the shared
 * `domain_events` log (src/lib/events/emit.ts), exactly the same "independent poller of
 * the log" relationship webhook delivery already has with that primitive. Nothing ever
 * writes a row here synchronously from a request handler — only the dispatch cron.
 *
 * `type` mirrors `domain_events.type`'s own free-text-not-enum convention (the
 * originating domain-event type string, e.g. "task.assigned") for the same reason: a new
 * trigger type must never need a migration just to start being recorded here.
 *
 * Tenant-owned (orgId FK) — included in `deleteOrganization()`'s cascade
 * (src/lib/platform/registry.ts), same as every other org-scoped table.
 */
export const notifications = pgTable(
  "notifications",
  {
    // "NTF-XXXXXXXX" — generateId("NTF").
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    // The recipient — plain text cross-reference to users.id, not FK-enforced, matching
    // every other cross-entity reference in this schema.
    userId: text("user_id").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link").notNull().default(""),
    isRead: boolean("is_read").notNull().default(false),
    // The domain_events.id this notification was generated from — "" for none (there is
    // currently no path that creates one without a source event, but this keeps the
    // column's meaning consistent with the rest of this codebase's "'' means none" style
    // rather than nullable). Used for traceability/dedup, not read on any hot path.
    sourceEventId: text("source_event_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The hot "my unread notifications" query (bell badge + dropdown list filter).
    index("notifications_org_id_user_id_is_read_idx").on(table.orgId, table.userId, table.isRead),
    // Ordering — "my recent notifications", newest first, regardless of read state.
    index("notifications_org_id_user_id_created_at_idx").on(table.orgId, table.userId, table.createdAt),
  ]
);
