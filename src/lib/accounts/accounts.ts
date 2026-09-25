import type { InferSelectModel } from "drizzle-orm";
import { and, eq, gte, lte } from "drizzle-orm";
import { invoices, pdiInspections, tmsShipments } from "@/db/schema";
import { db } from "@/db/client";
import { findById, insertRecord, listByOrg, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { getOrder, listOrderPayments, type OrderRecord } from "@/lib/orders/orders";
import { round2 } from "@/lib/leads/quotationMath";
import { postJournalEntry, SYSTEM_ACCOUNT_CODES } from "@/lib/accounts/ledger";
import { endOfIstDay, startOfIstDay } from "@/lib/timestamp";
import type { DateRange } from "@/lib/accounts/ledger";

/**
 * Accounts — Receivables seed, leg 5 alongside TMS (both pick up independently from
 * ORDER_PDI_PASSED; see src/db/schema/accounts.ts's own header comment). An order can carry
 * several `invoices` rows (multi-invoice split, added 2026-09-24) — see "remaining
 * invoiceable value" below for the mechanics that keep this safe.
 *
 * Statically imports orders.ts (getOrder()/listOrderPayments()) the same way tms.ts and
 * pdi.ts do — this file owns no order-header logic of its own.
 */

export class AccountsError extends Error {}

export type InvoiceStatus = "Draft" | "Issued";

export interface InvoiceRecord {
  id: string;
  orderId: string;
  invoiceNo: string;
  invoiceAttachmentUrl: string;
  ewayBillNo: string;
  ewayBillAttachmentUrl: string;
  extraDocumentUrl: string;
  finalValue: number;
  /** GST portion of finalValue, prorated from the order's own gstAmount by this invoice's
   * own share of the order total at creation time (capped so the running sum across every
   * invoice for the order never exceeds order.gstAmount — see createInvoice()'s own
   * comment). Booked to the GST Payable liability account at Issue time instead of Sales
   * Revenue. */
  gstAmount: number;
  status: InvoiceStatus;
  issuedBy: string;
  issuedAt: string;
  createdBy: string;
  createdAt: string;
}

type InvoiceRow = InferSelectModel<typeof invoices>;

function rowToInvoice(row: InvoiceRow): InvoiceRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    invoiceNo: row.invoiceNo,
    invoiceAttachmentUrl: row.invoiceAttachmentUrl,
    ewayBillNo: row.ewayBillNo,
    ewayBillAttachmentUrl: row.ewayBillAttachmentUrl,
    extraDocumentUrl: row.extraDocumentUrl,
    finalValue: Number(row.finalValue) || 0,
    gstAmount: Number(row.gstAmount) || 0,
    status: row.status,
    issuedBy: row.issuedBy,
    issuedAt: row.issuedAt ? row.issuedAt.toISOString() : "",
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Every invoice row for one order — an order can now carry several (multi-invoice split,
 * 2026-09-24). No `.limit(1)`: callers that only care about existence use `.length > 0`. */
async function listInvoicesForOrder(orgId: string, orderId: string): Promise<InvoiceRow[]> {
  return db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.orderId, orderId)));
}

/** A small rounding tolerance for the "remaining invoiceable value" comparisons below — two
 * numbers that have each individually been through round2() can still differ by a sub-paisa
 * float artifact once subtracted (e.g. 399.99999999999994 instead of 400), which would
 * otherwise wrongly refuse a Doer typing exactly the suggested remaining amount. Half a
 * paisa, same spirit as creditNotes.ts's own remainingCreditable check (which stays exact
 * because it never needed this extra subtraction-of-two-derived-sums step). */
const EPSILON = 0.005;

interface InvoicedSoFar {
  /** Sum of finalValue across every existing invoice for this order — Draft AND Issued both
   * count as a real claim on the order's own invoiceable total (see invoices' own schema
   * comment for why counting only Issued would let several full-value Drafts double-bill). */
  value: number;
  /** Sum of gstAmount across the same set — what createInvoice()/issueInvoice() cap this
   * invoice's own proportional GST against, so the running total per order never exceeds
   * orders.gstAmount. */
  gst: number;
  count: number;
}

async function invoicedSoFar(orgId: string, orderId: string): Promise<InvoicedSoFar> {
  const rows = await listInvoicesForOrder(orgId, orderId);
  return {
    value: round2(rows.reduce((sum, r) => sum + (Number(r.finalValue) || 0), 0)),
    gst: round2(rows.reduce((sum, r) => sum + (Number(r.gstAmount) || 0), 0)),
    count: rows.length,
  };
}

/** Same "has this order's PDI Passed" check `listInvoiceCandidates()` uses to build its own
 * candidate list — duplicated here (rather than only relied on client-side) so a direct
 * API call can't create an Invoice for an order that hasn't actually cleared PDI yet. */
async function hasPassedPdi(orgId: string, orderId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(pdiInspections)
    .where(
      and(
        eq(pdiInspections.orgId, orgId),
        eq(pdiInspections.orderId, orderId),
        eq(pdiInspections.status, "Passed")
      )
    )
    .limit(1);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Candidates — Passed-PDI orders with no invoice yet
// ---------------------------------------------------------------------------

/**
 * Every order whose PDI has Passed and still has a positive remaining invoiceable value —
 * Accounts' own candidate queue, mirroring TMS's/PDI's own listIntakeCandidates(). A
 * partially-invoiced order (multi-invoice split, 2026-09-24) stays a candidate for its next
 * split invoice instead of disappearing after the first one. Deliberately independent of
 * TMS's own "fully shipped" state (see CLAUDE.md: "Both TMS and Accounts should each be
 * independently correct and queryable") — an order can be invoiced before, during, or after
 * its own shipments are planned.
 */
export async function listInvoiceCandidates(): Promise<OrderRecord[]> {
  const orgId = await getTenantOrgId();
  const passedRows = await db
    .select()
    .from(pdiInspections)
    .where(and(eq(pdiInspections.orgId, orgId), eq(pdiInspections.status, "Passed")));

  const result: OrderRecord[] = [];
  for (const row of passedRows) {
    const order = await getOrder(row.orderId);
    if (!order) continue;
    const suggestion = await getInvoiceSuggestion(row.orderId);
    if (suggestion.suggestedFinalValue > EPSILON) result.push(order);
  }
  return result.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

// ---------------------------------------------------------------------------
// finalValue suggestion — order value + TMS freight, Self-arranged only
// ---------------------------------------------------------------------------

export interface InvoiceSuggestion {
  orderValue: number;
  /** Sum of this order's own tms_shipments.vehiclePrice — 0 unless
   * orders.transportArrangedBy === 'Self' (Party-arranged freight is never this org's
   * cost, see src/db/schema/tms.ts's own comment on vehiclePrice). */
  freightTotal: number;
  /** orderValue + freightTotal — the order's total invoiceable value across every invoice
   * for it, not just the next one. What invoicedSoFar()'s own value-sum is checked against. */
  totalInvoiceable: number;
  /** Sum of finalValue across every existing invoice (Draft + Issued) for this order. */
  alreadyInvoiced: number;
  /** How many invoices already exist for this order — 0 for a never-yet-invoiced order. */
  invoiceCount: number;
  /** totalInvoiceable - alreadyInvoiced, floored at 0 — the natural default for "what's
   * left to bill." Equals totalInvoiceable itself when invoiceCount is 0. */
  suggestedFinalValue: number;
}

export async function getInvoiceSuggestion(orderId: string): Promise<InvoiceSuggestion> {
  const orgId = await getTenantOrgId();
  const order = await getOrder(orderId);
  if (!order) throw new AccountsError("Order nahi mila.");

  let freightTotal = 0;
  if (order.transportArrangedBy === "Self") {
    const shipmentRows = await db
      .select()
      .from(tmsShipments)
      .where(and(eq(tmsShipments.orgId, orgId), eq(tmsShipments.orderId, orderId)));
    freightTotal = round2(shipmentRows.reduce((sum, s) => sum + (Number(s.vehiclePrice) || 0), 0));
  }

  const totalInvoiceable = round2(order.orderValue + freightTotal);
  const { value: alreadyInvoiced, count: invoiceCount } = await invoicedSoFar(orgId, orderId);

  return {
    orderValue: order.orderValue,
    freightTotal,
    totalInvoiceable,
    alreadyInvoiced,
    invoiceCount,
    suggestedFinalValue: Math.max(0, round2(totalInvoiceable - alreadyInvoiced)),
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listInvoices(status?: InvoiceStatus): Promise<InvoiceRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = status
    ? await db.select().from(invoices).where(and(eq(invoices.orgId, orgId), eq(invoices.status, status)))
    : await listByOrg(invoices, orgId);
  return rows.map(rowToInvoice).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export interface InvoiceDetail {
  invoice: InvoiceRecord;
  order: OrderRecord;
  /** What has actually been collected against this order so far — read live from
   * order_payments (Order FMS), never a second payments table (see CLAUDE.md). */
  totalReceived: number;
}

export async function getInvoice(invoiceId: string): Promise<InvoiceDetail | null> {
  const orgId = await getTenantOrgId();
  const row = await findById(invoices, orgId, invoiceId);
  if (!row) return null;
  const order = await getOrder(row.orderId);
  if (!order) return null;
  const payments = await listOrderPayments(row.orderId);
  const totalReceived = round2(payments.reduce((sum, p) => sum + p.amount, 0));
  return { invoice: rowToInvoice(row), order, totalReceived };
}

// ---------------------------------------------------------------------------
// Create (Draft) — as many invoices as the order's own remaining value allows
// ---------------------------------------------------------------------------

export interface CreateInvoiceInput {
  orderId: string;
  invoiceNo?: string;
  invoiceAttachmentUrl?: string;
  ewayBillNo?: string;
  ewayBillAttachmentUrl?: string;
  extraDocumentUrl?: string;
  /** The Doer sees a suggested value (getInvoiceSuggestion) but can adjust it before
   * saving — never silently locked, see CLAUDE.md's Accounts section. */
  finalValue: number;
}

/**
 * JUDGMENT CALL (documented per CLAUDE.md's instruction to name every one explicitly):
 * at Draft time, only `orderId` and `finalValue` are hard-required — invoiceNo/attachments/
 * e-way bill can all still be pending real paperwork. `issueInvoice()` below is where
 * invoiceNo + invoiceAttachmentUrl become mandatory, since "Issued" is meant to represent a
 * real, complete document. E-way bill stays optional even at Issue — not every dispatch
 * needs one (small value / intra-state exemptions), so this module doesn't assume it does.
 */
export async function createInvoice(input: CreateInvoiceInput, createdBy: string): Promise<InvoiceRecord> {
  const orgId = await getTenantOrgId();
  const order = await getOrder(input.orderId);
  if (!order) throw new AccountsError("Order nahi mila.");

  // listInvoiceCandidates() only ever surfaces Passed-PDI orders, but that's a UI-level
  // filter — re-check it here so a direct API call can't create an Invoice for an order
  // whose PDI hasn't Passed yet (goods not actually inspected/cleared for dispatch).
  if (!(await hasPassedPdi(orgId, input.orderId))) {
    throw new AccountsError("Is order ka PDI Pass nahi hua hai — Invoice sirf Passed-PDI order ke liye ban sakta hai.");
  }

  if (!(input.finalValue >= 0)) {
    throw new AccountsError("Final Value 0 ya usse zyada honi chahiye.");
  }

  // "Remaining invoiceable value" check — an order can now carry several invoices (Draft +
  // Issued both count as a real claim, see invoicedSoFar()'s own comment), but their sum can
  // never exceed the order's own total (order value + Self-arranged TMS freight). This is a
  // pre-check for a friendly error; there is no unique-constraint backstop against a genuine
  // concurrent-request race here (removed 2026-09-24 along with the old one-invoice-per-order
  // constraint) — same low-risk, human-triggered judgment call this codebase already makes
  // for Credit/Debit Note numbering (see CLAUDE.md's "What's still actually open").
  let suggestion: InvoiceSuggestion;
  try {
    suggestion = await getInvoiceSuggestion(input.orderId);
  } catch {
    throw new AccountsError("Order nahi mila.");
  }
  const finalValue = round2(input.finalValue);
  const remaining = round2(suggestion.totalInvoiceable - suggestion.alreadyInvoiced);
  if (finalValue > remaining + EPSILON) {
    throw new AccountsError(
      `Is order par sirf ₹${remaining} tak ka Invoice ban sakta hai — Order value ₹${suggestion.totalInvoiceable}, pehle se ₹${suggestion.alreadyInvoiced} invoice ho chuka hai.`
    );
  }

  // GST prorated to this invoice's own share of the order's total value, further capped so
  // the running sum across every invoice for the order can never exceed order.gstAmount —
  // proportional split in the opposite direction of creditNotes.ts's own createCreditNote()
  // (one invoice's GST split across many credit notes there; one order's GST split across
  // many invoices here), same reasoning.
  const { gst: alreadyInvoicedGst } = await invoicedSoFar(orgId, input.orderId);
  const gstAmount =
    suggestion.totalInvoiceable > 0
      ? round2(
          Math.min(
            (finalValue * order.gstAmount) / suggestion.totalInvoiceable,
            Math.max(0, round2(order.gstAmount - alreadyInvoicedGst))
          )
        )
      : 0;

  const invoiceId = generateId("INV");
  const row = await insertRecord(invoices, {
    id: invoiceId,
    orgId,
    orderId: input.orderId,
    invoiceNo: input.invoiceNo?.trim() ?? "",
    invoiceAttachmentUrl: input.invoiceAttachmentUrl?.trim() ?? "",
    ewayBillNo: input.ewayBillNo?.trim() ?? "",
    ewayBillAttachmentUrl: input.ewayBillAttachmentUrl?.trim() ?? "",
    extraDocumentUrl: input.extraDocumentUrl?.trim() ?? "",
    finalValue: String(finalValue),
    gstAmount: String(gstAmount),
    status: "Draft",
    createdBy,
  });
  return rowToInvoice(row);
}

export interface UpdateInvoiceInput {
  invoiceNo?: string;
  invoiceAttachmentUrl?: string;
  ewayBillNo?: string;
  ewayBillAttachmentUrl?: string;
  extraDocumentUrl?: string;
  finalValue?: number;
}

/** Editing a still-Draft invoice — e.g. attaching the real invoice/e-way bill document once
 * it's ready, or adjusting finalValue before Issue. Issued invoices are immutable (a real
 * business document, once issued, isn't silently rewritten). */
export async function updateInvoice(invoiceId: string, input: UpdateInvoiceInput): Promise<InvoiceRecord> {
  const orgId = await getTenantOrgId();
  const row = await findById(invoices, orgId, invoiceId);
  if (!row) throw new AccountsError("Invoice nahi mili.");
  if (row.status !== "Draft") {
    throw new AccountsError("Issued invoice edit nahi ho sakti.");
  }
  if (input.finalValue !== undefined && !(input.finalValue >= 0)) {
    throw new AccountsError("Final Value 0 ya usse zyada honi chahiye.");
  }

  const patch: Record<string, unknown> = {};
  if (input.invoiceNo !== undefined) patch.invoiceNo = input.invoiceNo.trim();
  if (input.invoiceAttachmentUrl !== undefined) patch.invoiceAttachmentUrl = input.invoiceAttachmentUrl.trim();
  if (input.ewayBillNo !== undefined) patch.ewayBillNo = input.ewayBillNo.trim();
  if (input.ewayBillAttachmentUrl !== undefined) patch.ewayBillAttachmentUrl = input.ewayBillAttachmentUrl.trim();
  if (input.extraDocumentUrl !== undefined) patch.extraDocumentUrl = input.extraDocumentUrl.trim();
  if (input.finalValue !== undefined) {
    // Same "remaining invoiceable value" guard createInvoice() applies — a Draft's
    // finalValue can be edited up as well as down, and re-widening it must not be able to
    // push the order's own total (across every one of its invoices) past what's actually
    // billable. Excludes this invoice's own current finalValue from "already invoiced"
    // before comparing, since it's being replaced, not added on top of itself.
    const finalValue = round2(input.finalValue);
    const suggestion = await getInvoiceSuggestion(row.orderId);
    const { value: allInvoiced } = await invoicedSoFar(orgId, row.orderId);
    const otherInvoiced = round2(allInvoiced - (Number(row.finalValue) || 0));
    const remaining = round2(suggestion.totalInvoiceable - otherInvoiced);
    if (finalValue > remaining + EPSILON) {
      throw new AccountsError(
        `Is order par sirf ₹${remaining} tak ka Invoice ban sakta hai — Order value ₹${suggestion.totalInvoiceable}, pehle se ₹${otherInvoiced} invoice ho chuka hai.`
      );
    }
    patch.finalValue = String(finalValue);
  }

  const updated = await updateById(invoices, orgId, invoiceId, patch);
  if (!updated) throw new AccountsError("Invoice update nahi ho payi.");
  return rowToInvoice(updated);
}

// ---------------------------------------------------------------------------
// Issue — the one status transition this module has
// ---------------------------------------------------------------------------

export async function issueInvoice(invoiceId: string, actorId: string): Promise<InvoiceRecord> {
  const orgId = await getTenantOrgId();
  const row = await findById(invoices, orgId, invoiceId);
  if (!row) throw new AccountsError("Invoice nahi mili.");
  if (row.status !== "Draft") {
    throw new AccountsError("Ye invoice pehle se Issued hai.");
  }
  if (!row.invoiceNo.trim()) {
    throw new AccountsError("Issue karne se pehle Invoice No. dena zaroori hai.");
  }
  if (!row.invoiceAttachmentUrl.trim()) {
    throw new AccountsError("Issue karne se pehle Invoice document attach karna zaroori hai.");
  }

  const updated = await updateById(invoices, orgId, invoiceId, {
    status: "Issued",
    issuedBy: actorId,
    issuedAt: new Date(),
  });
  if (!updated) throw new AccountsError("Issue nahi ho paya.");

  // GL posting — best-effort, matching this codebase's "never let a broken downstream
  // write undo something already saved" convention (see emitFmsEvent/notifyStepComplete):
  // the invoice is already Issued by this point regardless of whether this succeeds.
  const finalValue = Number(updated.finalValue) || 0;
  // Re-derived here rather than trusted from the row as-is: finalValue can be edited down (or
  // up, within the remaining-invoiceable cap — see updateInvoice()) any time while still
  // Draft, after gstAmount was already snapshotted at createInvoice() time against whatever
  // finalValue stood then. Same proportional-and-order-wide-capped shape createInvoice() uses
  // — this invoice's own share of order.gstAmount, further capped so the running sum across
  // every invoice for the order (this one included) never exceeds order.gstAmount. A plain
  // `Math.min(row.gstAmount, finalValue)` (the pre-multi-invoice version) would let several
  // invoices each separately re-clamp only against their own finalValue and jointly
  // over-book GST Payable.
  let gstAmount = 0;
  const order = await getOrder(updated.orderId);
  if (order && order.gstAmount > 0) {
    const suggestion = await getInvoiceSuggestion(updated.orderId);
    const { gst: allInvoicedGst } = await invoicedSoFar(orgId, updated.orderId);
    // allInvoicedGst already includes this invoice's own (pre-update) gstAmount — subtract
    // it back out to get what every OTHER invoice for this order has already booked.
    const otherInvoicedGst = round2(allInvoicedGst - (Number(row.gstAmount) || 0));
    const remainingGst = Math.max(0, round2(order.gstAmount - otherInvoicedGst));
    gstAmount =
      suggestion.totalInvoiceable > 0
        ? round2(Math.min((finalValue * order.gstAmount) / suggestion.totalInvoiceable, remainingGst))
        : 0;
  }
  if (finalValue > 0) {
    try {
      // Pre-GST invoices (gstAmount 0 — every invoice created before this GST-tracking
      // change defaults here) keep exactly the original 2-line posting. Otherwise split the
      // GST portion into its own liability line instead of folding it into Sales Revenue,
      // which used to overstate income/profit by the full tax amount collected.
      const lines =
        gstAmount > 0
          ? [
              { accountCode: SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, debit: finalValue },
              {
                accountCode: SYSTEM_ACCOUNT_CODES.SALES_REVENUE,
                credit: round2(finalValue - gstAmount),
              },
              { accountCode: SYSTEM_ACCOUNT_CODES.GST_PAYABLE, credit: gstAmount },
            ]
          : [
              { accountCode: SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, debit: finalValue },
              { accountCode: SYSTEM_ACCOUNT_CODES.SALES_REVENUE, credit: finalValue },
            ];
      await postJournalEntry({
        orgId,
        description: `Invoice ${invoiceId} issued — Order ${updated.orderId}`,
        sourceType: "Invoice",
        sourceId: invoiceId,
        createdBy: actorId,
        lines,
      });
    } catch (error) {
      console.error(`[accounts] postJournalEntry failed for invoice ${invoiceId}:`, error);
    }
  }

  return rowToInvoice(updated);
}

// ---------------------------------------------------------------------------
// Receivables Aging — how long each order's own outstanding balance has been open
// ---------------------------------------------------------------------------

export type AgingBucket = "0-30" | "31-60" | "61-90" | "90+";

export interface AgingRow {
  orderId: string;
  partyName: string;
  /** The order's own earliest Issued invoice date — an order becomes a receivable the day
   * it's first billed, not the day its (possibly later) other invoices were issued. */
  earliestInvoiceDate: string;
  daysOutstanding: number;
  bucket: AgingBucket;
  outstanding: number;
}

export interface AgingSummary {
  rows: AgingRow[];
  bucketTotals: Record<AgingBucket, number>;
  grandTotal: number;
}

function agingBucketFor(days: number): AgingBucket {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

/**
 * Ages at the ORDER level, not per-invoice — a deliberate scope decision. `order_payments`
 * (what's actually been collected, Order FMS's own table) is keyed by orderId, not by any
 * specific invoice, and an order can now carry several invoices (multi-invoice split,
 * 2026-09-24) — there is no clean way to know which specific invoice a given payment was
 * "for." So: sum every Issued invoice's finalValue for an order, subtract that order's own
 * total order_payments, and age from the EARLIEST of its Issued invoices (the day the order
 * first became a receivable). An order with nothing left outstanding is simply omitted.
 */
export async function getReceivablesAging(): Promise<AgingSummary> {
  const orgId = await getTenantOrgId();
  const issuedRows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.status, "Issued")));

  const byOrder = new Map<string, InvoiceRow[]>();
  for (const row of issuedRows) {
    const arr = byOrder.get(row.orderId) ?? [];
    arr.push(row);
    byOrder.set(row.orderId, arr);
  }

  const rows: AgingRow[] = [];
  const bucketTotals: Record<AgingBucket, number> = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  let grandTotal = 0;
  const now = Date.now();

  for (const [orderId, orderInvoices] of byOrder) {
    const totalInvoiced = round2(orderInvoices.reduce((sum, r) => sum + (Number(r.finalValue) || 0), 0));
    const payments = await listOrderPayments(orderId);
    const totalReceived = round2(payments.reduce((sum, p) => sum + p.amount, 0));
    const outstanding = round2(totalInvoiced - totalReceived);
    if (outstanding <= EPSILON) continue; // fully paid — not a receivable anymore

    const order = await getOrder(orderId);
    if (!order) continue;

    const earliestIssuedAt = orderInvoices.reduce<Date | null>((earliest, r) => {
      if (!r.issuedAt) return earliest;
      return !earliest || r.issuedAt < earliest ? r.issuedAt : earliest;
    }, null);
    const earliest = earliestIssuedAt ?? new Date();
    const daysOutstanding = Math.max(0, Math.floor((now - earliest.getTime()) / (24 * 60 * 60 * 1000)));
    const bucket = agingBucketFor(daysOutstanding);

    rows.push({
      orderId,
      partyName: order.partyName,
      earliestInvoiceDate: earliest.toISOString(),
      daysOutstanding,
      bucket,
      outstanding,
    });
    bucketTotals[bucket] = round2(bucketTotals[bucket] + outstanding);
    grandTotal = round2(grandTotal + outstanding);
  }

  rows.sort((a, b) => b.daysOutstanding - a.daysOutstanding);
  return { rows, bucketTotals, grandTotal };
}

// ---------------------------------------------------------------------------
// GST Return support — a GSTR-1/GSTR-3B-SHAPED report/export, not e-filing
// ---------------------------------------------------------------------------

/**
 * This is deliberately a report for the org's own accountant to manually file on the
 * government GST portal — it does NOT integrate with any GST Suvidha Provider (GSP) API,
 * does NOT submit anything anywhere, needs no digital signature or GSP credentials. The UI
 * says this explicitly. It also only ever reports OUTPUT GST (from Issued Sales Invoices) —
 * Input Tax Credit (GST the org itself paid to its own vendors) is not tracked anywhere in
 * this codebase (`bills` carries a flat `amount`, no GST split), so this is not a net-payable
 * figure. Don't "complete" that here; it's a real, separate, unscoped gap.
 */
export interface GstReturnLine {
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  customerName: string;
  customerGstin: string;
  taxableValue: number;
  gstAmount: number;
  invoiceValue: number;
}

export interface GstReturnSummary {
  lines: GstReturnLine[];
  totalTaxableValue: number;
  totalGst: number;
  totalInvoiceValue: number;
}

export async function getGstReturnSummary(range?: DateRange): Promise<GstReturnSummary> {
  const orgId = await getTenantOrgId();
  const conditions = [eq(invoices.orgId, orgId), eq(invoices.status, "Issued")];
  // Same IST-day-boundary helpers ledger.ts's own getTrialBalance() uses — a bare
  // `new Date("YYYY-MM-DD")` truncates to UTC midnight (5:30am IST), silently excluding
  // almost a full business day for an India-based org (the same bug class already fixed
  // once in the recurring-task generator and once in ledger.ts itself).
  if (range?.from) conditions.push(gte(invoices.issuedAt, startOfIstDay(range.from)));
  if (range?.to) conditions.push(lte(invoices.issuedAt, endOfIstDay(range.to)));

  const rows = await db
    .select()
    .from(invoices)
    .where(and(...conditions));

  const lines: GstReturnLine[] = [];
  let totalTaxableValue = 0;
  let totalGst = 0;
  let totalInvoiceValue = 0;

  for (const row of rows) {
    const order = await getOrder(row.orderId);
    const finalValue = Number(row.finalValue) || 0;
    const gstAmount = Number(row.gstAmount) || 0;
    const taxableValue = round2(finalValue - gstAmount);

    lines.push({
      invoiceId: row.id,
      invoiceNo: row.invoiceNo,
      invoiceDate: row.issuedAt ? row.issuedAt.toISOString() : "",
      customerName: order?.partyName ?? "",
      customerGstin: order?.customerGst ?? "",
      taxableValue,
      gstAmount,
      invoiceValue: finalValue,
    });
    totalTaxableValue = round2(totalTaxableValue + taxableValue);
    totalGst = round2(totalGst + gstAmount);
    totalInvoiceValue = round2(totalInvoiceValue + finalValue);
  }

  lines.sort((a, b) => (a.invoiceDate < b.invoiceDate ? -1 : 1));
  return { lines, totalTaxableValue, totalGst, totalInvoiceValue };
}
