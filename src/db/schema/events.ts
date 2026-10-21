import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * Generic, append-only "something happened" log — the one shared primitive two future
 * features (webhook delivery, in-app notification center) both consume instead of each
 * growing its own bespoke trigger wiring into Orders/Inventory/etc. Writers only ever
 * INSERT here (via `src/lib/events/emit.ts`'s `emitDomainEvent()`); nothing in this schema
 * file itself reads/pages through rows — that contract lives in `emit.ts`'s own
 * `listDomainEventsSince()` and its doc comment, since the two future consumer agents are
 * told to read only that file's exported signatures.
 *
 * `payload` is deliberately a plain, unmodelled JSON blob (`jsonb`, no `$type<...>()`
 * pin) — this table is a generic envelope for many different event `type`s with
 * different shapes, not a single-purpose table where a fixed payload shape would help.
 * Each event `type`'s own emitter (see `emit.ts` call sites) is the source of truth for
 * what keys its own payload carries; consumers must treat payload defensively.
 *
 * Included in `deleteOrganization()`'s cascade (`src/lib/platform/registry.ts`) like
 * every other tenant-owned table with an `org_id` FK — this table's rows are exactly as
 * much this org's own data as an order or a stock movement is.
 */
export const domainEvents = pgTable(
  "domain_events",
  {
    // "EVT-XXXXXXXX" — generateId("EVT"), same convention as every other business id.
    // Deliberately NOT used for chronological ordering (it's a random suffix, not a
    // sequence) — see listDomainEventsSince()'s own comment on how paging actually works.
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    // e.g. "order.status_changed", "stock.movement_recorded", "task.assigned",
    // "approval.pending" — a free-text dotted namespace, not a pgEnum, on purpose: new
    // event types (task-assignment/approval-pending, wired later by the notification-center
    // agent, or anything else) must never need a migration just to add a new string value.
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Backs both listDomainEventsSince()'s own (orgId, createdAt) range scan and any
    // future per-org polling/paging consumer that filters by org first.
    index("domain_events_org_id_created_at_idx").on(table.orgId, table.createdAt),
  ]
);
