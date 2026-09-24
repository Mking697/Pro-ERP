import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq, inArray } from "drizzle-orm";
import { bills, billPayments, purchaseOrders, vendors } from "@/db/schema";
import { db } from "@/db/client";
import { findById, insertRecord, listByOrg, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { round2 } from "@/lib/leads/quotationMath";
import { getPurchaseOrder } from "@/lib/purchase/orders";
import { postJournalEntry, SYSTEM_ACCOUNT_CODES } from "@/lib/accounts/ledger";

/**
 * Payables — the mirror of Receivables (src/lib/accounts/accounts.ts) against a Purchase
 * Order instead of a Sales Order. Same narrow shape: one `bills` row per PO, an
 * append-only `bill_payments` log. See src/db/schema/accounts.ts's own header comment.
 *
 * Intake ("which POs can be billed"): a Purchase Order whose own flow (src/lib/purchase/
 * orders.ts) has reached `status: "Completed"` (Material Received done for every line) and
 * has no `bills` row against it yet — queried directly against `bills` rather than a new
 * forward-pointer column on `purchase_orders`, per this build's own explicit instruction
 * (`purchase_orders` has no `bill_id`-style column today, and adding one is a schema
 * change out of scope for this pass).
 */

export class PayablesError extends Error {}

export type BillStatus = "Draft" | "Issued";
// "Credit_Note" is listed here only because bill_payments.mode reuses orderPaymentModeEnum
// at the DB level (see accounts.ts's own comment on that column) — a Bill is never actually
// paid via a customer's own Credit Note, this codebase's Payables logic never writes it.
export type BillPaymentMode =
  | "Cash"
  | "UPI"
  | "Bank_Transfer"
  | "Cheque"
  | "Card"
  | "Credit_Note"
  | "Other";

export interface BillRecord {
  id: string;
  poId: string;
  vendorId: string;
  vendorName: string;
  billNo: string;
  billAttachmentUrl: string;
  amount: number;
  status: BillStatus;
  issuedBy: string;
  issuedAt: string;
  createdBy: string;
  createdAt: string;
}

type BillRow = InferSelectModel<typeof bills>;

function rowToBill(row: BillRow, vendorName: string): BillRecord {
  return {
    id: row.id,
    poId: row.poId,
    vendorId: row.vendorId,
    vendorName,
    billNo: row.billNo,
    billAttachmentUrl: row.billAttachmentUrl,
    amount: Number(row.amount) || 0,
    status: row.status,
    issuedBy: row.issuedBy,
    issuedAt: row.issuedAt ? row.issuedAt.toISOString() : "",
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/** True for a Postgres unique-violation (23505) against the given constraint name — same
 * helper this codebase's other retry-on-collision call sites duplicate locally (ledger.ts,
 * accounts.ts, dispatch.ts's confirmDispatch, quotations.ts's insertQuotationRow) rather
 * than share. */
function isUniqueViolation(error: unknown, constraintName: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; constraint?: unknown; message?: unknown };
  if (e.code !== "23505") return false;
  if (typeof e.constraint === "string") return e.constraint === constraintName;
  return typeof e.message === "string" && e.message.includes(constraintName);
}

async function findBillByPoId(orgId: string, poId: string): Promise<BillRow | null> {
  const rows = await db
    .select()
    .from(bills)
    .where(and(eq(bills.orgId, orgId), eq(bills.poId, poId)))
    .limit(1);
  return rows[0] ?? null;
}

async function vendorNameFor(orgId: string, vendorId: string): Promise<string> {
  if (!vendorId) return "";
  const vendor = await findById(vendors, orgId, vendorId);
  return vendor?.vendorName ?? "";
}

// ---------------------------------------------------------------------------
// Candidates — Completed POs with no bill yet
// ---------------------------------------------------------------------------

export interface BillCandidate {
  poId: string;
  vendorId: string;
  vendorName: string;
  /** Sum of every line's qty * (newPrice ?? oldPrice) — the PO's own real value, read via
   * src/lib/purchase/orders.ts's getPurchaseOrder() (which already joins each line's
   * indent-derived qty) rather than re-deriving it here. Purely a suggestion — createBill()
   * still takes `amount` as a normal, editable field, same as Receivables' own
   * getInvoiceSuggestion()/finalValue. */
  poValue: number;
  issuedAt: string;
}

export async function listBillCandidates(): Promise<BillCandidate[]> {
  const orgId = await getTenantOrgId();
  const poRows = await db
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.orgId, orgId), eq(purchaseOrders.status, "Completed")));

  const result: BillCandidate[] = [];
  for (const po of poRows) {
    const existing = await findBillByPoId(orgId, po.id);
    if (existing) continue;
    const full = await getPurchaseOrder(po.id);
    if (!full) continue;
    const poValue = round2(
      full.lines.reduce((sum, line) => sum + line.qty * (Number(line.newPrice || line.oldPrice) || 0), 0)
    );
    result.push({ poId: po.id, vendorId: po.vendorId, vendorName: full.vendorName, poValue, issuedAt: po.issuedAt.toISOString() });
  }

  return result.sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listBills(status?: BillStatus): Promise<BillRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = status
    ? await db.select().from(bills).where(and(eq(bills.orgId, orgId), eq(bills.status, status)))
    : await listByOrg(bills, orgId);

  const vendorIds = [...new Set(rows.map((r) => r.vendorId))];
  const vendorRows =
    vendorIds.length > 0
      ? await db.select().from(vendors).where(and(eq(vendors.orgId, orgId), inArray(vendors.id, vendorIds)))
      : [];
  const vendorNameMap = new Map(vendorRows.map((v) => [v.id, v.vendorName]));

  return rows
    .map((r) => rowToBill(r, vendorNameMap.get(r.vendorId) ?? ""))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export interface BillPaymentRecord {
  id: string;
  billId: string;
  amount: number;
  mode: BillPaymentMode;
  reference: string;
  paidAt: string;
  recordedBy: string;
}

export interface BillDetail {
  bill: BillRecord;
  totalPaid: number;
  payments: BillPaymentRecord[];
}

export async function getBill(billId: string): Promise<BillDetail | null> {
  const orgId = await getTenantOrgId();
  const row = await findById(bills, orgId, billId);
  if (!row) return null;

  const paymentRows = await db
    .select()
    .from(billPayments)
    .where(and(eq(billPayments.orgId, orgId), eq(billPayments.billId, billId)))
    .orderBy(desc(billPayments.paidAt));
  const payments: BillPaymentRecord[] = paymentRows.map((p) => ({
    id: p.id,
    billId: p.billId,
    amount: Number(p.amount) || 0,
    mode: p.mode,
    reference: p.reference,
    paidAt: p.paidAt.toISOString(),
    recordedBy: p.recordedBy,
  }));
  const totalPaid = round2(payments.reduce((sum, p) => sum + p.amount, 0));

  return { bill: rowToBill(row, await vendorNameFor(orgId, row.vendorId)), totalPaid, payments };
}

// ---------------------------------------------------------------------------
// Create (Draft) — one bill per PO
// ---------------------------------------------------------------------------

export interface CreateBillInput {
  poId: string;
  billNo?: string;
  billAttachmentUrl?: string;
  amount: number;
}

/** JUDGMENT CALL, mirroring Receivables' own createInvoice(): at Draft time only `poId` and
 * `amount` are required — billNo/attachment can follow once the vendor's real invoice
 * arrives. issueBill() below is where both become mandatory. */
export async function createBill(input: CreateBillInput, createdBy: string): Promise<BillRecord> {
  const orgId = await getTenantOrgId();
  const po = await findById(purchaseOrders, orgId, input.poId);
  if (!po) throw new PayablesError("Purchase Order nahi mila.");
  if (po.status !== "Completed") {
    throw new PayablesError(`Ye PO "${po.status}" hai — Bill sirf Completed PO ke liye ban sakta hai.`);
  }
  const existing = await findBillByPoId(orgId, input.poId);
  if (existing) throw new PayablesError("Is PO ke liye pehle hi ek Bill ban chuki hai.");
  if (!(input.amount >= 0)) throw new PayablesError("Amount 0 ya usse zyada hona chahiye.");

  const billId = generateId("BILL");
  try {
    const row = await insertRecord(bills, {
      id: billId,
      orgId,
      poId: input.poId,
      vendorId: po.vendorId,
      billNo: input.billNo?.trim() ?? "",
      billAttachmentUrl: input.billAttachmentUrl?.trim() ?? "",
      amount: String(round2(input.amount)),
      status: "Draft",
      createdBy,
    });
    return rowToBill(row, await vendorNameFor(orgId, po.vendorId));
  } catch (error) {
    // The pre-check above (`existing`) closes the common case with a clean error before
    // any insert is attempted; this is the real backstop against a genuine race — two
    // concurrent requests both passing that pre-check before either insert lands. The DB's
    // own bills_org_id_po_id_unique constraint is what actually stops the duplicate row
    // from being created; this just turns the resulting 23505 into the same friendly
    // domain error instead of an unhandled Postgres error.
    if (isUniqueViolation(error, "bills_org_id_po_id_unique")) {
      throw new PayablesError("Is PO ke liye pehle hi ek Bill ban chuki hai.");
    }
    throw error;
  }
}

export interface UpdateBillInput {
  billNo?: string;
  billAttachmentUrl?: string;
  amount?: number;
}

export async function updateBill(billId: string, input: UpdateBillInput): Promise<BillRecord> {
  const orgId = await getTenantOrgId();
  const row = await findById(bills, orgId, billId);
  if (!row) throw new PayablesError("Bill nahi mili.");
  if (row.status !== "Draft") throw new PayablesError("Issued bill edit nahi ho sakti.");
  if (input.amount !== undefined && !(input.amount >= 0)) {
    throw new PayablesError("Amount 0 ya usse zyada hona chahiye.");
  }

  const patch: Record<string, unknown> = {};
  if (input.billNo !== undefined) patch.billNo = input.billNo.trim();
  if (input.billAttachmentUrl !== undefined) patch.billAttachmentUrl = input.billAttachmentUrl.trim();
  if (input.amount !== undefined) patch.amount = String(round2(input.amount));

  const updated = await updateById(bills, orgId, billId, patch);
  if (!updated) throw new PayablesError("Bill update nahi ho payi.");
  return rowToBill(updated, await vendorNameFor(orgId, updated.vendorId));
}

// ---------------------------------------------------------------------------
// Issue — Draft -> Issued, posts Dr Purchases/Expense / Cr Accounts Payable
// ---------------------------------------------------------------------------

export async function issueBill(billId: string, actorId: string): Promise<BillRecord> {
  const orgId = await getTenantOrgId();
  const row = await findById(bills, orgId, billId);
  if (!row) throw new PayablesError("Bill nahi mili.");
  if (row.status !== "Draft") throw new PayablesError("Ye bill pehle se Issued hai.");
  if (!row.billNo.trim()) throw new PayablesError("Issue karne se pehle Bill No. dena zaroori hai.");
  if (!row.billAttachmentUrl.trim()) {
    throw new PayablesError("Issue karne se pehle Bill document attach karna zaroori hai.");
  }

  const updated = await updateById(bills, orgId, billId, {
    status: "Issued",
    issuedBy: actorId,
    issuedAt: new Date(),
  });
  if (!updated) throw new PayablesError("Issue nahi ho paya.");

  // GL posting — best-effort, matching Receivables' issueInvoice()'s own convention: the
  // bill is already Issued regardless of whether this succeeds.
  const amount = Number(updated.amount) || 0;
  if (amount > 0) {
    try {
      await postJournalEntry({
        orgId,
        description: `Bill ${billId} issued — PO ${row.poId}`,
        sourceType: "Bill",
        sourceId: billId,
        createdBy: actorId,
        lines: [
          { accountCode: SYSTEM_ACCOUNT_CODES.PURCHASES_EXPENSE, debit: amount },
          { accountCode: SYSTEM_ACCOUNT_CODES.ACCOUNTS_PAYABLE, credit: amount },
        ],
      });
    } catch (error) {
      console.error(`[payables] postJournalEntry failed for bill ${billId}:`, error);
    }
  }

  return rowToBill(updated, await vendorNameFor(orgId, updated.vendorId));
}

// ---------------------------------------------------------------------------
// Payments — the Payables mirror of orders.ts's own recordPayment()
// ---------------------------------------------------------------------------

export interface RecordBillPaymentInput {
  amount: number;
  mode: BillPaymentMode;
  reference?: string;
  /** ISO instant — defaults to now. */
  paidAt?: string;
}

export async function recordBillPayment(
  billId: string,
  input: RecordBillPaymentInput,
  actorId: string
): Promise<BillRecord> {
  if (!(input.amount > 0)) throw new PayablesError("Amount 0 se zyada hona chahiye.");

  const orgId = await getTenantOrgId();
  const row = await findById(bills, orgId, billId);
  if (!row) throw new PayablesError("Bill nahi mili.");
  if (row.status !== "Issued") throw new PayablesError("Sirf Issued bill par payment record ho sakta hai.");

  const amount = round2(input.amount);
  await insertRecord(billPayments, {
    id: generateId("BPY"),
    orgId,
    billId,
    amount: String(amount),
    mode: input.mode,
    reference: input.reference?.trim() ?? "",
    paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
    recordedBy: actorId,
  });

  // GL posting — best-effort, same convention as every other posting hook: the payment
  // itself is already recorded regardless of whether this succeeds.
  try {
    await postJournalEntry({
      orgId,
      description: `Payment made — Bill ${billId}`,
      sourceType: "PayablePayment",
      sourceId: billId,
      createdBy: actorId,
      lines: [
        { accountCode: SYSTEM_ACCOUNT_CODES.ACCOUNTS_PAYABLE, debit: amount },
        { accountCode: SYSTEM_ACCOUNT_CODES.CASH_BANK, credit: amount },
      ],
    });
  } catch (error) {
    console.error(`[payables] postJournalEntry failed for bill payment ${billId}:`, error);
  }

  return rowToBill(row, await vendorNameFor(orgId, row.vendorId));
}
