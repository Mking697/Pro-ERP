import type { InferSelectModel } from "drizzle-orm";
import { and, eq, inArray } from "drizzle-orm";
import { creditNotes, creditNoteUsages, customers, invoices, journalEntries, journalLines, orderPayments } from "@/db/schema";
import { db } from "@/db/client";
import { findById, listByOrg } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { round2 } from "@/lib/leads/quotationMath";
import { getOrder } from "@/lib/orders/orders";
import { SYSTEM_ACCOUNT_CODES, listChartOfAccounts } from "@/lib/accounts/ledger";

/**
 * Credit Notes (2026-09-24) — the reverse of an Invoice: a Sales Return, a transit-loss
 * write-off the customer shouldn't be billed for, or a price adjustment. See
 * src/db/schema/accounts.ts's own header comment on `creditNotes`/`creditNoteUsages` for the
 * full design reasoning, and ledger.ts's own comment on SYSTEM_ACCOUNT_CODES.
 * CUSTOMER_CREDIT_BALANCE for why a Credit Note credits its own Liability account rather
 * than Accounts Receivable directly.
 *
 * Every write here posts its journal entry atomically alongside its own domain row(s), in
 * one `db.batch()` — same reasoning as expenses.ts/pettyCash.ts: this write IS the primary
 * financial action (no Draft step), so it must not half-happen. `postJournalEntry()`
 * (ledger.ts) is not reused for the same reason those two files don't reuse it — it runs
 * its own separate, independently-committing `db.batch()`.
 */

export class CreditNoteError extends Error {}

export type CreditNoteReason = "Sales_Return" | "Transit_Loss" | "Price_Adjustment" | "Other";

export interface CreditNoteRecord {
  id: string;
  creditNoteNo: string;
  invoiceId: string;
  orderId: string;
  customerId: string;
  customerName: string;
  reason: string;
  amount: number;
  gstAmount: number;
  /** amount - sum(this note's own credit_note_usages) — live-derived, never stored. */
  remainingBalance: number;
  attachmentUrl: string;
  createdBy: string;
  createdAt: string;
}

type CreditNoteRow = InferSelectModel<typeof creditNotes>;

function rowToCreditNote(row: CreditNoteRow, customerName: string, remainingBalance: number): CreditNoteRecord {
  return {
    id: row.id,
    creditNoteNo: row.creditNoteNo,
    invoiceId: row.invoiceId,
    orderId: row.orderId,
    customerId: row.customerId,
    customerName,
    reason: row.reason,
    amount: Number(row.amount) || 0,
    gstAmount: Number(row.gstAmount) || 0,
    remainingBalance,
    attachmentUrl: row.attachmentUrl,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Sum of a set of credit notes' own usages, grouped by creditNoteId — one query for
 * however many notes are being enriched, rather than one query per note. */
async function usedAmountsByNoteId(orgId: string, noteIds: string[]): Promise<Map<string, number>> {
  const used = new Map<string, number>();
  if (noteIds.length === 0) return used;
  const rows = await db
    .select({ creditNoteId: creditNoteUsages.creditNoteId, amount: creditNoteUsages.amount })
    .from(creditNoteUsages)
    .where(and(eq(creditNoteUsages.orgId, orgId), inArray(creditNoteUsages.creditNoteId, noteIds)));
  for (const row of rows) {
    const current = used.get(row.creditNoteId) ?? 0;
    used.set(row.creditNoteId, round2(current + (Number(row.amount) || 0)));
  }
  return used;
}

async function enrichCreditNotes(orgId: string, rows: CreditNoteRow[]): Promise<CreditNoteRecord[]> {
  if (rows.length === 0) return [];

  const customerIds = [...new Set(rows.map((r) => r.customerId))];
  const customerRows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.orgId, orgId), inArray(customers.id, customerIds)));
  const nameById = new Map(customerRows.map((c) => [c.id, c.customerName]));

  const used = await usedAmountsByNoteId(orgId, rows.map((r) => r.id));

  return rows
    .map((row) => {
      const amount = Number(row.amount) || 0;
      const remaining = round2(amount - (used.get(row.id) ?? 0));
      return rowToCreditNote(row, nameById.get(row.customerId) ?? "", remaining);
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** One credit note's own remaining balance — used by applyCreditNoteToOrder()/
 * refundCreditNote() to validate before posting a new usage against it. */
async function remainingBalanceFor(orgId: string, noteId: string, amount: number): Promise<number> {
  const rows = await db
    .select({ amount: creditNoteUsages.amount })
    .from(creditNoteUsages)
    .where(and(eq(creditNoteUsages.orgId, orgId), eq(creditNoteUsages.creditNoteId, noteId)));
  const used = round2(rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0));
  return round2(amount - used);
}

// ---------------------------------------------------------------------------
// Create — against exactly one Issued invoice
// ---------------------------------------------------------------------------

/**
 * REF-numbering, same "read the highest, add one" shape as quotations.ts's own
 * allocateQuotationNumber()/dispatches.ts's own gate-pass allocator — BUT deliberately
 * WITHOUT their retry-on-collision loop: those two are backed by a real
 * `unique(org_id, ...)` constraint, so a 23505 from a genuine race is something their retry
 * loop can actually catch. `credit_notes.creditNoteNo` has no such constraint (the schema
 * migration that added this table only indexed `customerId`/`invoiceId`, not `creditNoteNo`
 * itself) — writing a retry loop here would be dead code that can never fire, since nothing
 * in Postgres would ever reject the second insert. Judgment call: credit notes are a
 * low-volume, human-triggered action (nothing like quotations/dispatches' own bulk-import or
 * high-frequency paths), so the practical risk of two landing in the exact same instant is
 * low — but if this ever needs to be airtight, the real fix is a
 * `unique(org_id, credit_note_no)` constraint added in its own schema change, not a retry
 * loop with nothing backing it.
 */
async function allocateCreditNoteNumber(orgId: string): Promise<string> {
  const existing = await db
    .select({ creditNoteNo: creditNotes.creditNoteNo })
    .from(creditNotes)
    .where(eq(creditNotes.orgId, orgId));

  const pattern = /^CN-(\d+)$/;
  let maxNumber = 0;
  for (const row of existing) {
    const match = pattern.exec(row.creditNoteNo);
    if (match) maxNumber = Math.max(maxNumber, Number(match[1]));
  }
  return `CN-${String(maxNumber + 1).padStart(4, "0")}`;
}

export interface CreateCreditNoteInput {
  invoiceId: string;
  amount: number;
  reason?: CreditNoteReason | string;
  /** Overrides the proportional GST computation below when given — some Price_Adjustment
   * credit notes may have no GST component at all even if the original invoice did. Capped
   * to `amount` either way. */
  gstAmount?: number;
  attachmentUrl?: string;
}

/**
 * Issues a Credit Note against exactly one Issued invoice and posts, atomically:
 * `Dr Sales Revenue (amount - gstAmount) / Dr GST Payable (gstAmount, only if > 0) /
 * Cr Customer Credit Balance (amount)`.
 */
export async function createCreditNote(
  input: CreateCreditNoteInput,
  createdBy: string
): Promise<CreditNoteRecord> {
  const orgId = await getTenantOrgId();
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new CreditNoteError("Amount 0 se zyada hona chahiye.");

  const invoiceRow = await findById(invoices, orgId, input.invoiceId);
  if (!invoiceRow) throw new CreditNoteError("Invoice nahi mili.");
  if (invoiceRow.status !== "Issued") {
    throw new CreditNoteError("Credit Note sirf Issued invoice ke against ban sakta hai.");
  }

  const order = await getOrder(invoiceRow.orderId);
  if (!order) throw new CreditNoteError("Is invoice ka order nahi mila.");
  if (!order.customerId) throw new CreditNoteError("Is order se koi customer link nahi hai.");

  const finalValue = Number(invoiceRow.finalValue) || 0;
  const existingRows = await db
    .select({ amount: creditNotes.amount })
    .from(creditNotes)
    .where(and(eq(creditNotes.orgId, orgId), eq(creditNotes.invoiceId, input.invoiceId)));
  const alreadyCredited = round2(existingRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0));
  const remainingCreditable = round2(finalValue - alreadyCredited);
  if (amount > remainingCreditable) {
    throw new CreditNoteError(
      `Is invoice par sirf ₹${remainingCreditable} tak ka Credit Note ban sakta hai — Invoice ₹${finalValue}, pehle se ₹${alreadyCredited} credit ho chuka hai.`
    );
  }

  const invoiceGstAmount = Number(invoiceRow.gstAmount) || 0;
  let gstAmount: number;
  if (input.gstAmount !== undefined) {
    gstAmount = round2(Math.min(Math.max(0, input.gstAmount), amount));
  } else {
    gstAmount = finalValue > 0 ? round2(Math.min((amount * invoiceGstAmount) / finalValue, amount)) : 0;
  }

  const accounts = await listChartOfAccounts();
  const salesRevenue = accounts.find((a) => a.code === SYSTEM_ACCOUNT_CODES.SALES_REVENUE);
  const gstPayable = accounts.find((a) => a.code === SYSTEM_ACCOUNT_CODES.GST_PAYABLE);
  const customerCreditBalance = accounts.find((a) => a.code === SYSTEM_ACCOUNT_CODES.CUSTOMER_CREDIT_BALANCE);
  if (!salesRevenue || !gstPayable || !customerCreditBalance) {
    throw new CreditNoteError("Chart of Accounts me zaroori system accounts nahi mile.");
  }

  const reason = (input.reason ?? "").trim();
  const creditNoteId = generateId("CRN");
  const creditNoteNo = await allocateCreditNoteNumber(orgId);
  const journalEntryId = generateId("JE");
  const entryDate = new Date();

  const creditNoteInsert = db.insert(creditNotes).values({
    id: creditNoteId,
    orgId,
    invoiceId: input.invoiceId,
    orderId: invoiceRow.orderId,
    customerId: order.customerId,
    creditNoteNo,
    reason,
    amount: String(amount),
    gstAmount: String(gstAmount),
    attachmentUrl: input.attachmentUrl?.trim() ?? "",
    createdBy,
  });

  const journalEntryInsert = db.insert(journalEntries).values({
    id: journalEntryId,
    orgId,
    entryDate,
    description: `Credit Note ${creditNoteNo} — Invoice ${invoiceRow.id}${reason ? ` (${reason})` : ""}`,
    sourceType: "CreditNote",
    sourceId: creditNoteId,
    createdBy,
  });

  // amount = revenueDebit + gstAmount by construction, and amount > 0, so at least one of
  // these two lines is always non-zero — postJournalEntry()'s own "every line non-zero"
  // rule (which this function doesn't call, but mirrors) is satisfied without extra checks.
  const revenueDebit = round2(amount - gstAmount);
  const lines: { entryId: string; orgId: string; lineNo: number; accountId: string; debit: string; credit: string }[] = [];
  if (revenueDebit > 0) {
    lines.push({ entryId: journalEntryId, orgId, lineNo: lines.length + 1, accountId: salesRevenue.id, debit: String(revenueDebit), credit: "0" });
  }
  if (gstAmount > 0) {
    lines.push({ entryId: journalEntryId, orgId, lineNo: lines.length + 1, accountId: gstPayable.id, debit: String(gstAmount), credit: "0" });
  }
  lines.push({ entryId: journalEntryId, orgId, lineNo: lines.length + 1, accountId: customerCreditBalance.id, debit: "0", credit: String(amount) });

  const journalLinesInsert = db.insert(journalLines).values(lines);

  await db.batch([creditNoteInsert, journalEntryInsert, journalLinesInsert]);

  const row = await findById(creditNotes, orgId, creditNoteId);
  if (!row) throw new CreditNoteError("Credit Note ban gaya lekin load nahi ho paya.");
  const customerRow = await findById(customers, orgId, order.customerId);
  return rowToCreditNote(row, customerRow?.customerName ?? "", amount);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listCreditNotes(): Promise<CreditNoteRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await listByOrg(creditNotes, orgId);
  return enrichCreditNotes(orgId, rows);
}

export async function listCreditNotesForCustomer(customerId: string): Promise<CreditNoteRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(creditNotes)
    .where(and(eq(creditNotes.orgId, orgId), eq(creditNotes.customerId, customerId)));
  return enrichCreditNotes(orgId, rows);
}

/** One credit note, enriched — backs the Apply/Refund dialogs' own detail fetch (they need
 * the note's customerId to know which orders to offer for "Apply to an Order"). */
export async function getCreditNote(creditNoteId: string): Promise<CreditNoteRecord | null> {
  const orgId = await getTenantOrgId();
  const row = await findById(creditNotes, orgId, creditNoteId);
  if (!row) return null;
  const enriched = await enrichCreditNotes(orgId, [row]);
  return enriched[0] ?? null;
}

/** Sum of all of one customer's credit notes minus all usages against those notes — the
 * customer's own total available credit, live-derived, never stored (same convention as
 * every other running balance in this codebase). */
export async function getCustomerCreditBalance(customerId: string): Promise<number> {
  const orgId = await getTenantOrgId();
  const noteRows = await db
    .select({ id: creditNotes.id, amount: creditNotes.amount })
    .from(creditNotes)
    .where(and(eq(creditNotes.orgId, orgId), eq(creditNotes.customerId, customerId)));
  if (noteRows.length === 0) return 0;

  const totalIssued = round2(noteRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0));
  const used = await usedAmountsByNoteId(orgId, noteRows.map((r) => r.id));
  const totalUsed = round2([...used.values()].reduce((sum, v) => sum + v, 0));
  return round2(totalIssued - totalUsed);
}

// ---------------------------------------------------------------------------
// Apply — a note's value becomes a real order_payments row (mode "Credit_Note")
// ---------------------------------------------------------------------------

export interface ApplyCreditNoteInput {
  creditNoteId: string;
  orderId: string;
  amount: number;
}

/**
 * Posts `Dr Customer Credit Balance / Cr Accounts Receivable` and inserts a real
 * `order_payments` row (mode "Credit_Note") — this is deliberately what makes Order FMS's
 * own existing credit-gate math (computeCreditPosition() in orders.ts) see this as a real
 * payment with zero changes needed there: it only ever sums order_payments.amount, blind to
 * mode.
 */
export async function applyCreditNoteToOrder(
  input: ApplyCreditNoteInput,
  createdBy: string
): Promise<CreditNoteRecord> {
  const orgId = await getTenantOrgId();
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new CreditNoteError("Amount 0 se zyada hona chahiye.");

  const noteRow = await findById(creditNotes, orgId, input.creditNoteId);
  if (!noteRow) throw new CreditNoteError("Credit Note nahi mila.");

  const remaining = await remainingBalanceFor(orgId, noteRow.id, Number(noteRow.amount) || 0);
  if (amount > remaining) {
    throw new CreditNoteError(`Is Credit Note ka sirf ₹${remaining} balance bacha hai.`);
  }

  const order = await getOrder(input.orderId);
  if (!order) throw new CreditNoteError("Order nahi mila.");
  if (order.customerId !== noteRow.customerId) {
    throw new CreditNoteError("Ye Credit Note is order ke customer ka nahi hai.");
  }
  if (order.status === "Cancelled") {
    throw new CreditNoteError("Cancelled order par Credit Note apply nahi ho sakta.");
  }

  const accounts = await listChartOfAccounts();
  const customerCreditBalance = accounts.find((a) => a.code === SYSTEM_ACCOUNT_CODES.CUSTOMER_CREDIT_BALANCE);
  const accountsReceivable = accounts.find((a) => a.code === SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE);
  if (!customerCreditBalance || !accountsReceivable) {
    throw new CreditNoteError("Chart of Accounts me zaroori system accounts nahi mile.");
  }

  const usageId = generateId("CNU");
  const journalEntryId = generateId("JE");
  const entryDate = new Date();

  const usageInsert = db.insert(creditNoteUsages).values({
    id: usageId,
    orgId,
    creditNoteId: noteRow.id,
    kind: "Applied",
    orderId: input.orderId,
    amount: String(amount),
    createdBy,
  });

  const paymentInsert = db.insert(orderPayments).values({
    id: generateId("OPY"),
    orgId,
    orderId: input.orderId,
    amount: String(amount),
    mode: "Credit_Note",
    reference: noteRow.creditNoteNo,
    receivedAt: entryDate,
    recordedBy: createdBy,
  });

  const journalEntryInsert = db.insert(journalEntries).values({
    id: journalEntryId,
    orgId,
    entryDate,
    description: `Credit Note ${noteRow.creditNoteNo} applied — Order ${input.orderId}`,
    sourceType: "CreditNoteUsage",
    sourceId: usageId,
    createdBy,
  });

  const journalLinesInsert = db.insert(journalLines).values([
    { entryId: journalEntryId, orgId, lineNo: 1, accountId: customerCreditBalance.id, debit: String(amount), credit: "0" },
    { entryId: journalEntryId, orgId, lineNo: 2, accountId: accountsReceivable.id, debit: "0", credit: String(amount) },
  ]);

  await db.batch([usageInsert, paymentInsert, journalEntryInsert, journalLinesInsert]);

  const updatedNote = await findById(creditNotes, orgId, noteRow.id);
  if (!updatedNote) throw new CreditNoteError("Apply ho gaya lekin Credit Note load nahi ho paya.");
  const customerRow = await findById(customers, orgId, noteRow.customerId);
  const newRemaining = await remainingBalanceFor(orgId, noteRow.id, Number(updatedNote.amount) || 0);
  return rowToCreditNote(updatedNote, customerRow?.customerName ?? "", newRemaining);
}

// ---------------------------------------------------------------------------
// Refund — a note's value paid out in real cash
// ---------------------------------------------------------------------------

export interface RefundCreditNoteInput {
  creditNoteId: string;
  amount: number;
}

/** Posts `Dr Customer Credit Balance / Cr Cash-Bank` — the note's value is paid back to the
 * customer in real cash instead of being applied to a future order. */
export async function refundCreditNote(
  input: RefundCreditNoteInput,
  createdBy: string
): Promise<CreditNoteRecord> {
  const orgId = await getTenantOrgId();
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new CreditNoteError("Amount 0 se zyada hona chahiye.");

  const noteRow = await findById(creditNotes, orgId, input.creditNoteId);
  if (!noteRow) throw new CreditNoteError("Credit Note nahi mila.");

  const remaining = await remainingBalanceFor(orgId, noteRow.id, Number(noteRow.amount) || 0);
  if (amount > remaining) {
    throw new CreditNoteError(`Is Credit Note ka sirf ₹${remaining} balance bacha hai.`);
  }

  const accounts = await listChartOfAccounts();
  const customerCreditBalance = accounts.find((a) => a.code === SYSTEM_ACCOUNT_CODES.CUSTOMER_CREDIT_BALANCE);
  const cashAccount = accounts.find((a) => a.code === SYSTEM_ACCOUNT_CODES.CASH_BANK);
  if (!customerCreditBalance || !cashAccount) {
    throw new CreditNoteError("Chart of Accounts me zaroori system accounts nahi mile.");
  }

  const usageId = generateId("CNU");
  const journalEntryId = generateId("JE");
  const entryDate = new Date();

  const usageInsert = db.insert(creditNoteUsages).values({
    id: usageId,
    orgId,
    creditNoteId: noteRow.id,
    kind: "Refunded",
    amount: String(amount),
    createdBy,
  });

  const journalEntryInsert = db.insert(journalEntries).values({
    id: journalEntryId,
    orgId,
    entryDate,
    description: `Credit Note ${noteRow.creditNoteNo} refunded in cash`,
    sourceType: "CreditNoteUsage",
    sourceId: usageId,
    createdBy,
  });

  const journalLinesInsert = db.insert(journalLines).values([
    { entryId: journalEntryId, orgId, lineNo: 1, accountId: customerCreditBalance.id, debit: String(amount), credit: "0" },
    { entryId: journalEntryId, orgId, lineNo: 2, accountId: cashAccount.id, debit: "0", credit: String(amount) },
  ]);

  await db.batch([usageInsert, journalEntryInsert, journalLinesInsert]);

  const updatedNote = await findById(creditNotes, orgId, noteRow.id);
  if (!updatedNote) throw new CreditNoteError("Refund ho gaya lekin Credit Note load nahi ho paya.");
  const customerRow = await findById(customers, orgId, noteRow.customerId);
  const newRemaining = await remainingBalanceFor(orgId, noteRow.id, Number(updatedNote.amount) || 0);
  return rowToCreditNote(updatedNote, customerRow?.customerName ?? "", newRemaining);
}
