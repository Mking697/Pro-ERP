import { jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/** A receipt is inserted in the same transaction as its domain writes. No pending rows. */
export const mutationReceipts = pgTable("mutation_receipts", {
  orgId: text("org_id").notNull().references(() => organizations.id),
  key: text("key").notNull(),
  actorId: text("actor_id").notNull(),
  operation: text("operation").notNull(),
  // SHA-256 of canonical { actorId, operation, payload }, not raw JSON text.
  payloadHash: text("payload_hash").notNull(),
  result: jsonb("result").$type<unknown>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.orgId, table.key] })]);
