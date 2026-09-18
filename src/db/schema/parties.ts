import { pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * Mirrors MODULE_SHEETS' VENDORS and CUSTOMERS — src/lib/parties/vendors.ts, customers.ts.
 */

// Only "Active" is ever written today (no deactivate endpoint exists yet for either
// master) — JUDGMENT CALL: modeled as the same Active/Inactive binary every other master
// (Items, Users) already uses, rather than leaving Status as unconstrained `text`, since
// that is this codebase's one established status convention for a "master" record.
export const vendorStatusEnum = pgEnum("vendor_status", ["Active", "Inactive"]);
export const customerStatusEnum = pgEnum("customer_status", ["Active", "Inactive"]);

export const vendors = pgTable("vendors", {
  // Vendor_ID, e.g. "VEN-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  vendorName: text("vendor_name").notNull(),
  contactPerson: text("contact_person").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  gstin: text("gstin").notNull().default(""),
  address: text("address").notNull().default(""),
  city: text("city").notNull().default(""),
  state: text("state").notNull().default(""),
  paymentTerms: text("payment_terms").notNull().default(""),
  bankName: text("bank_name").notNull().default(""),
  bankAccountNo: text("bank_account_no").notNull().default(""),
  ifsc: text("ifsc").notNull().default(""),
  status: vendorStatusEnum("status").notNull().default("Active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by").notNull().default(""),
});

export const customers = pgTable("customers", {
  // Customer_ID, e.g. "CUS-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  customerName: text("customer_name").notNull(),
  contactPerson: text("contact_person").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  gstin: text("gstin").notNull().default(""),
  billingAddress: text("billing_address").notNull().default(""),
  shippingAddress: text("shipping_address").notNull().default(""),
  city: text("city").notNull().default(""),
  state: text("state").notNull().default(""),
  creditTerms: text("credit_terms").notNull().default(""),
  status: customerStatusEnum("status").notNull().default("Active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: text("created_by").notNull().default(""),
});
