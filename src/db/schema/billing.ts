import { index, numeric, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * One row per Razorpay Standard Checkout order an org's own Admin initiated from
 * `/billing` (src/lib/billing/**) — a payment ATTEMPT, not a confirmed payment; a row is
 * created the moment Checkout opens and only flips to "Paid" after the server itself
 * independently verifies the HMAC-SHA256 signature Razorpay returns (never trusts the
 * browser's own claim that payment succeeded). Named `billingPayments`, not `billPayments`
 * — that name is already taken by accounts.ts's unrelated vendor-bill-payment table.
 *
 * Deliberately NOT a Razorpay Subscription row — this codebase's self-serve flow is
 * Standard Checkout (one order per billing cycle the org manually pays), not auto-debit
 * recurring billing. `organizations.planRenewsAt` is what actually drives "this org needs
 * to pay again", read by whatever future reminder job wants it; this table is the receipt
 * trail for every attempt, successful or not.
 */
export const billingPaymentStatusEnum = pgEnum("billing_payment_status", [
  "Created",
  "Paid",
  "Failed",
]);

export const billingPayments = pgTable(
  "billing_payments",
  {
    // "PAY-xxxx" — verbatim generateId(), same convention as every other business id.
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    // PlanTier at the time of purchase ("Starter" | "Growth" | "Enterprise") — plain text,
    // same "an unknown/future value falls back safely elsewhere" convention as
    // organizations.plan itself; this column is a historical record, not re-validated.
    plan: text("plan").notNull(),
    // "Monthly" | "Yearly".
    billingCycle: text("billing_cycle").notNull(),
    // Rupees, not paise — matches this codebase's existing "money stays plain numeric
    // throughout" convention (see quotations/purchase orders); converted to paise only at
    // the Razorpay API boundary (src/lib/billing/razorpay.ts).
    amount: numeric("amount").notNull(),
    currency: text("currency").notNull().default("INR"),
    // Razorpay's own order id ("order_...") — unique, so verify-payment can look a row up
    // by it and safely no-op a replayed/duplicate verification call instead of
    // double-applying a plan change.
    razorpayOrderId: text("razorpay_order_id").notNull().unique(),
    // Only set once Razorpay's checkout actually returns a payment id — blank on every
    // "Created" (not yet paid) and "Failed" row.
    razorpayPaymentId: text("razorpay_payment_id").notNull().default(""),
    status: billingPaymentStatusEnum("status").notNull().default("Created"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
  },
  (table) => [
    index("billing_payments_org_id_idx").on(table.orgId),
  ]
);
