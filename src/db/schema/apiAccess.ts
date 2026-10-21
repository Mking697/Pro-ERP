import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * Phase B item #1 — read-only API-key-authenticated REST API + webhook delivery, both
 * built on top of the `domain_events` primitive (src/db/schema/events.ts /
 * src/lib/events/emit.ts). Three tables:
 *
 *  - `api_keys`       — long-lived bearer secrets an org's Admin mints for server-to-
 *                        server reads against `/api/v1/*` (see src/lib/apiAccess/apiKeys.ts).
 *  - `webhook_subscriptions` — an org's own outbound delivery targets, each polling a
 *                        subset of domain-event types (see src/lib/apiAccess/webhooks.ts).
 *  - `webhook_deliveries`    — one row per delivery ATTEMPT, the dispatcher's own retry/
 *                        audit ledger (src/lib/apiAccess/webhooks.ts's dispatchPendingWebhooks()).
 *
 * All three are tenant-owned (orgId FK) and therefore MUST be (and are) included in
 * `deleteOrganization()`'s cascade (src/lib/platform/registry.ts) — picked up
 * automatically by `tenantScopedTables()`'s reflection, but the actual `db.delete(...)`
 * line still has to be added by hand, see registry.ts.
 */

export const apiKeys = pgTable(
  "api_keys",
  {
    // "API-XXXXXXXX" — generateId("API").
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    label: text("label").notNull(),
    // sha256 hex digest of the real secret — the plaintext key is NEVER stored anywhere,
    // only returned once at creation time (see generateApiKey()'s own doc comment).
    keyHash: text("key_hash").notNull(),
    // First ~8 chars of the real key, shown in the admin UI so an Admin can tell two keys
    // apart without ever being shown the secret again.
    keyPrefix: text("key_prefix").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Updated best-effort on successful auth (see verifyApiKey()) — a write failure here
    // must never fail the auth check itself.
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    // Null = active. Set = revoked. Rows are never deleted so lastUsedAt/audit history
    // survives a revoke — mirrors how this codebase never hard-deletes an audit trail.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("api_keys_org_id_idx").on(table.orgId)]
);

export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    // "WHK-XXXXXXXX" — generateId("WHK").
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    url: text("url").notNull(),
    // Subset of the known domain_events `type` values — "order.status_changed" /
    // "stock.movement_recorded" today (see src/lib/events/emit.ts's own header comment).
    eventTypes: text("event_types").array().notNull().default([]),
    // Random secret, generated server-side at creation, used to HMAC-sign every delivered
    // payload (see webhooks.ts's dispatchPendingWebhooks() doc comment for the exact
    // signing scheme) — shown once like the API key, never re-shown after creation.
    secret: text("secret").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    // The last domain_events.id this subscription has successfully processed PAST — null
    // means "not started yet", exactly matching listDomainEventsSince()'s own sinceId=null
    // convention so this column can be passed straight through as that function's cursor.
    cursorEventId: text("cursor_event_id"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("webhook_subscriptions_org_id_idx").on(table.orgId)]
);

export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "Pending",
  "Success",
  "Failed",
  "Abandoned",
]);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    // "WHD-XXXXXXXX" — generateId("WHD").
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    // Plain text cross-reference, NOT a hard FK — same convention this codebase already
    // uses for most non-platform cross-table references (see e.g. generalPurchase.ts's
    // own vendorItems.vendorId, which points at vendors.id the same way).
    subscriptionId: text("subscription_id").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    // Snapshotted at delivery time — a subscription's own url can change later without
    // rewriting history here.
    url: text("url").notNull(),
    // Payload snapshot taken at delivery-row creation time, so a retry never needs to
    // re-query domain_events for it (see webhooks.ts's own doc comment on why this is
    // preferred over a live re-fetch).
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    attemptCount: integer("attempt_count").notNull().default(0),
    status: webhookDeliveryStatusEnum("status").notNull().default("Pending"),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    responseStatus: integer("response_status"),
    // First ~500 chars of the response body only, for debugging — never a full arbitrary
    // response body (see webhooks.ts's own truncation).
    responseSnippet: text("response_snippet").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Backs the dispatcher's own per-org, per-status scan (pending retries) each poll cycle.
    index("webhook_deliveries_org_id_status_idx").on(table.orgId, table.status),
    index("webhook_deliveries_org_id_subscription_id_idx").on(table.orgId, table.subscriptionId),
  ]
);
