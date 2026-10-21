import { boolean, index, numeric, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * Multi-currency DISPLAY/REFERENCE layer (Phase C) — Orders/Invoices/POs keep booking in
 * base-currency (INR) exactly as before (orders.orderValue/gstAmount, invoices.finalValue/
 * gstAmount, purchase_orders header's own INR pricing via purchaseOrderLines.oldPrice/
 * newPrice) — every credit-limit check, GL posting and report keeps reading those columns
 * completely unchanged. These three tables ONLY hold the foreign-currency face amount and
 * the rate used to convert it, so a document can additionally *show* "$5,000 (~ ₹4,17,500)"
 * without any existing numeric code path having to know multi-currency exists at all.
 *
 * `currencies` is platform-wide, not org-scoped — mirrors src/db/schema/platform.ts's own
 * header comment (organizations/reportShares aren't tenant-scoped because they describe a
 * tenant rather than belonging to one): a currency is a fixed reference list every org
 * picks FROM, nobody owns a `code` row for themselves.
 */
export const currencies = pgTable("currencies", {
  // ISO 4217, e.g. "USD" — the real key, no surrogate id needed.
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  symbol: text("symbol").notNull(),
});

/**
 * Which foreign currencies THIS org has chosen to offer on Orders/Invoices/POs — an Admin
 * toggle in Settings. INR never gets a row here: every org implicitly has its own base
 * currency always available, not something that can be toggled off (see
 * `listEnabledCurrencies()` in src/lib/currency/currency.ts, which always synthesizes an
 * INR entry first regardless of what's in this table).
 *
 * `currencyCode` is a plain text reference to `currencies.code`, not FK-enforced — same
 * cross-entity convention as every other cross-table reference in this schema (see
 * src/db/schema/parties.ts's vendorItems doc comment for why: it keeps
 * `deleteOrganization()`'s batch delete free of cross-table ordering).
 */
export const orgEnabledCurrencies = pgTable(
  "org_enabled_currencies",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    currencyCode: text("currency_code").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.currencyCode] }),
    index("org_enabled_currencies_org_id_idx").on(table.orgId),
  ]
);

/**
 * Append-only exchange-rate history — an Admin adds a new row whenever they want to update
 * a rate; nothing is ever edited or deleted. Live use (`getLatestExchangeRate()` with no
 * `asOfDate`) always reads the most recent row as of now; a document snapshotting a rate at
 * its own creation time (`orders.displayExchangeRate`, etc.) reads the row active AT THAT
 * MOMENT and then never re-reads this table again for that document — same "a document
 * fact as it stood" convention as every other snapshot column in this schema (see e.g.
 * src/db/schema/orders.ts's own partyName/billingAddress comment). Deliberately NOT shaped
 * like `vendor_items.unitPrice` (a single mutable current value) — a rate snapshotted onto
 * an old order must never silently change just because a newer rate was added later.
 */
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    currencyCode: text("currency_code").notNull(),
    // How many INR = 1 unit of this currency, e.g. "83.50" for 1 USD = INR 83.50.
    rateToInr: numeric("rate_to_inr").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("exchange_rates_org_id_currency_code_effective_from_idx").on(
      table.orgId,
      table.currencyCode,
      table.effectiveFrom
    ),
  ]
);
