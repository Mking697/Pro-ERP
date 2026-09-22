import type { InferSelectModel } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import { invoices, pdiInspections, tmsShipments } from "@/db/schema";
import { db } from "@/db/client";
import { findById, insertRecord, listByOrg, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { getOrder, listOrderPayments, type OrderRecord } from "@/lib/orders/orders";
import { round2 } from "@/lib/leads/quotationMath";
import { postJournalEntry, SYSTEM_ACCOUNT_CODES } from "@/lib/accounts/ledger";

/**
 * Accounts — Receivables seed, leg 5 alongside TMS (both pick up independently from
 * ORDER_PDI_PASSED; see src/db/schema/accounts.ts's own header comment). One `invoices`
 * row per order. Deliberately narrow: no GL, no aging, no multi-invoice split — see
 * CLAUDE.md's Accounts section for the full scope boundary.
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
    status: row.status,
    issuedBy: row.issuedBy,
    issuedAt: row.issuedAt ? row.issuedAt.toISOString() : "",
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

async function findInvoiceByOrderId(orgId: string, orderId: string): Promise<InvoiceRow | null> {
  const rows = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.orderId, orderId)))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Candidates — Passed-PDI orders with no invoice yet
// ---------------------------------------------------------------------------

/**
 * Every order whose PDI has Passed and has no `invoices` row yet — Accounts' own candidate
 * queue, mirroring TMS's/PDI's own listIntakeCandidates(). Deliberately independent of
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
    const existingInvoice = await findInvoiceByOrderId(orgId, row.orderId);
    if (existingInvoice) continue;
    const order = await getOrder(row.orderId);
    if (order) result.push(order);
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

  return {
    orderValue: order.orderValue,
    freightTotal,
    suggestedFinalValue: round2(order.orderValue + freightTotal),
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
// Create (Draft) — one invoice per order
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

  const existing = await findInvoiceByOrderId(orgId, input.orderId);
  if (existing) throw new AccountsError("Is order ke liye pehle hi ek Invoice ban chuki hai.");

  if (!(input.finalValue >= 0)) {
    throw new AccountsError("Final Value 0 ya usse zyada honi chahiye.");
  }

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
    finalValue: String(round2(input.finalValue)),
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
  if (input.finalValue !== undefined) patch.finalValue = String(round2(input.finalValue));

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
  if (finalValue > 0) {
    try {
      await postJournalEntry({
        orgId,
        description: `Invoice ${invoiceId} issued — Order ${updated.orderId}`,
        sourceType: "Invoice",
        sourceId: invoiceId,
        createdBy: actorId,
        lines: [
          { accountCode: SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, debit: finalValue },
          { accountCode: SYSTEM_ACCOUNT_CODES.SALES_REVENUE, credit: finalValue },
        ],
      });
    } catch (error) {
      console.error(`[accounts] postJournalEntry failed for invoice ${invoiceId}:`, error);
    }
  }

  return rowToInvoice(updated);
}
