import {
  index,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * The Lead FMS: Lead capture -> pipeline (Qualify -> Follow-up -> Meeting -> Negotiation)
 * -> Quotation -> Order Confirmed. Built as its own hardcoded flow, not a generic FMS
 * Template, matching Purchase FMS's precedent — a pipeline board, bulk import, and a
 * spreadsheet-style quotation grid all need bespoke UI the generic Form/Lookup model has
 * no slot for.
 *
 * "Order Confirmed" is Lead FMS's own terminal state, not a full Order module — that is
 * the next, separate FMS (see CLAUDE.md's Sales chain notes). Accepting a quotation here
 * only flips the lead to Order_Confirmed and best-effort emits a chaining event
 * ("LEAD_ORDER_CONFIRMED") for that future module to pick up, the same way
 * INDENT_APPROVED/INWARD_ENTRY_CREATED already chain into other flows.
 */

export const leadStatusEnum = pgEnum("lead_status", [
  "New",
  "Qualified",
  "Junk",
  "Follow_Up",
  "Meeting_Scheduled",
  "Negotiation",
  "Quotation_Sent",
  "Order_Confirmed",
  "Lost",
]);

export const leads = pgTable(
  "leads",
  {
  // Lead_ID, e.g. "LED-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  // A lead can arrive with nothing but a name and a phone number — everything else here
  // is optional, matching how it's actually captured (manual punch or a bulk import row).
  personName: text("person_name").notNull(),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  companyName: text("company_name").notNull().default(""),
  city: text("city").notNull().default(""),
  state: text("state").notNull().default(""),
  // LEAD_SOURCES ("Manual" | "Bulk_Import" | "Referral" | "Website" | "Exhibition" |
  // "Cold_Call" | "Other") — closed but not itself a Status column, kept text.
  source: text("source").notNull().default(""),
  productInterest: text("product_interest").notNull().default(""),
  message: text("message").notNull().default(""),
  status: leadStatusEnum("status").notNull().default("New"),
  assignedTo: text("assigned_to").notNull().default(""),
  // Drives the Follow-up/Meeting reminder and the "overdue" flag — set to a future date on
  // "Call Back Later" or "Reschedule", cleared once that step is actually completed.
  nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
  meetingAt: timestamp("meeting_at", { withTimezone: true }),
  meetingMode: text("meeting_mode").notNull().default(""),
  lostReason: text("lost_reason").notNull().default(""),
  createdBy: text("created_by").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("leads_org_id_status_idx").on(table.orgId, table.status)]
);

// LeadActivityRecord.Kind — one row per pipeline event, append-only, so a lead's full
// history survives even as its own Status/Next_Follow_Up_At columns get overwritten in
// place. Mirrors leave_reassignments' "keep a full audit trail" convention.
export const leadActivityKindEnum = pgEnum("lead_activity_kind", [
  "Note",
  "Status_Change",
  "Follow_Up",
  "Meeting",
  "Negotiation",
  "Quotation",
  "Won",
  "Lost",
]);

export const leadActivities = pgTable(
  "lead_activities",
  {
    // Activity_ID, e.g. "LAC-xxxx".
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    leadId: text("lead_id").notNull(),
    kind: leadActivityKindEnum("kind").notNull(),
    message: text("message").notNull(),
    actorId: text("actor_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("lead_activities_org_id_lead_id_idx").on(table.orgId, table.leadId)]
);

// QuotationRecord.Status — Draft while being built, Sent once issued, Accepted is
// terminal (the point Lead FMS hands off to the future Order FMS), Rejected/Expired are
// terminal the other way.
export const quotationStatusEnum = pgEnum("quotation_status", [
  "Draft",
  "Sent",
  "Accepted",
  "Rejected",
  "Expired",
]);

/**
 * What the customer is sent before an order exists. Party/address/subject/note/terms are
 * SNAPSHOT here at creation time (copied from the lead and from Quotation Setup defaults),
 * not read live — a quotation is a document that was sent on a date, so a later edit to
 * the lead's address or to the org's default terms must never silently rewrite one already
 * out the door.
 */
export const quotations = pgTable(
  "quotations",
  {
  // Quotation_ID, e.g. "QUO-xxxx" — the real key. quotationNo is a separate,
  // sequential, customer-facing document number (e.g. "QN-0007"), continuing whatever
  // series the org was already on — same reasoning as Purchase's PO numbering, kept
  // human-readable for GST/accounting continuity rather than reusing this random id.
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  quotationNo: text("quotation_no").notNull().default(""),
  status: quotationStatusEnum("status").notNull().default("Draft"),
  // "" for a walk-in quoted without a lead behind it.
  leadId: text("lead_id").notNull().default(""),
  partyName: text("party_name").notNull(),
  contactPerson: text("contact_person").notNull().default(""),
  customerMobile: text("customer_mobile").notNull().default(""),
  customerEmail: text("customer_email").notNull().default(""),
  customerGst: text("customer_gst").notNull().default(""),
  billingAddress: text("billing_address").notNull().default(""),
  billingCity: text("billing_city").notNull().default(""),
  billingState: text("billing_state").notNull().default(""),
  billingPincode: text("billing_pincode").notNull().default(""),
  // Blank shipping fields mean "same as billing" at render time — not copied in twice.
  shippingPartyName: text("shipping_party_name").notNull().default(""),
  shippingContactPerson: text("shipping_contact_person").notNull().default(""),
  shippingAddress: text("shipping_address").notNull().default(""),
  shippingCity: text("shipping_city").notNull().default(""),
  shippingState: text("shipping_state").notNull().default(""),
  shippingPincode: text("shipping_pincode").notNull().default(""),
  subject: text("subject").notNull().default(""),
  note: text("note").notNull().default(""),
  terms: text("terms").notNull().default(""),
  // Recomputed from quotation_items on every save — never re-typed, never drifts.
  subTotal: numeric("sub_total").notNull().default("0"),
  freightAmount: numeric("freight_amount").notNull().default("0"),
  gstPercent: numeric("gst_percent").notNull().default("18"),
  gstAmount: numeric("gst_amount").notNull().default("0"),
  // subTotal + freightAmount + gstAmount. What an order would be placed for.
  payableAmount: numeric("payable_amount").notNull().default("0"),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  attachmentUrl: text("attachment_url").notNull().default(""),
  // "" until Order FMS punches this Accepted quotation into an Order — same forward-
  // pointer convention as indents.poId (src/db/schema/inventory.ts): the upstream record
  // carries the link, so Order FMS's own intake queue is a cheap `status = 'Accepted' AND
  // order_id = ''` scan rather than a reverse join.
  orderId: text("order_id").notNull().default(""),
  createdBy: text("created_by").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("quotations_org_id_quotation_no_unique").on(table.orgId, table.quotationNo),
    index("quotations_org_id_status_idx").on(table.orgId, table.status),
  ]
);

/**
 * One row per line of the quotation grid, grouped by Quotation_ID — same "no per-row id in
 * a flat, versionable document" shape as `bom`/`purchase_order_lines`, so the primary key
 * is the natural composite (quotation_id, line_no).
 */
export const quotationItems = pgTable(
  "quotation_items",
  {
    quotationId: text("quotation_id").notNull(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    lineNo: text("line_no").notNull(),
    particular: text("particular").notNull().default(""),
    specification: text("specification").notNull().default(""),
    description: text("description").notNull().default(""),
    uom: text("uom").notNull().default(""),
    // The expression the quantity was worked out from, e.g. "2.5*3+1.2", exactly as typed
    // into the calculator — kept alongside the answer (qty) so a line can be reopened and
    // corrected rather than recalculated from memory. "" when qty was typed as a plain
    // number.
    qtyFormula: text("qty_formula").notNull().default(""),
    qty: numeric("qty").notNull().default("0"),
    rate: numeric("rate").notNull().default("0"),
    // qty * rate, rounded once here — nothing downstream re-derives it.
    amount: numeric("amount").notNull().default("0"),
  },
  (table) => [
    primaryKey({ columns: [table.quotationId, table.lineNo] }),
    index("quotation_items_org_id_idx").on(table.orgId),
  ]
);
