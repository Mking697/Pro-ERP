import type { InferSelectModel } from "drizzle-orm";
import { and, eq, inArray } from "drizzle-orm";
import { billPayments, debitNotes, debitNoteUsages, failureLog, journalEntries, journalLines, vendors } from "@/db/schema";
import { db } from "@/db/client";
import { findById, listByOrg } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { round2 } from "@/lib/leads/quotationMath";
import { getBill } from "@/lib/accounts/payables";
import { SYSTEM_ACCOUNT_CODES, listChartOfAccounts } from "@/lib/accounts/ledger";

/**
 * Debit Notes (2026-09-24) — the Payables-side mirror of Credit Notes
 * (src/lib/accounts/creditNotes.ts), opposite direction: a claim AGAINST a vendor instead of
 * a concession TO a customer. Same shape, same conventions, deliberately mirrored rather
 * than reinvented — see creditNotes.ts's own header comment for the full reasoning this
 * file reuses (atomic `db.batch()` posting, `postJournalEntry()` not reused, live-derived
 * remaining balance, no retry-on-collision numbering).
 *
 * Most commonly issued against a Failure Log entry (a purchased quantity that failed IQC —
 * see src/lib/inward/deviation.ts for the independent "Accept Under Deviation" action on the
 * same entry), but `linkedFailureLogId` is optional — a Debit Note can be issued for any
 * vendor-compensation reason, not only an IQC failure.
 *
 * Deliberately does NOT credit Accounts Payable directly — see ledger.ts's own comment on
 * SYSTEM_ACCOUNT_CODES.VENDOR_CLAIM_RECEIVABLE for why a separate Asset account is correct
 * regardless of whether the original Bill (if any) is already paid.
 */

export class DebitNoteError extends Error {}

export type DebitNoteReason = "IQC_Fail" | "Other";

export interface DebitNoteRecord {
  id: string;
  debitNoteNo: string;
  vendorId: string;
  vendorName: string;
  reason: string;
  linkedFailureLogId: string;
  amount: number;
  /** amount - sum(this note's own debit_note_usages) — live-derived, never stored. */
  remainingBalance: number;
  attachmentUrl: string;
  createdBy: string;
  createdAt: string;
}

type DebitNoteRow = InferSelectModel<typeof debitNotes>;

function rowToDebitNote(row: DebitNoteRow, vendorName: string, remainingBalance: number): DebitNoteRecord {
  return {
    id: row.id,
    debitNoteNo: row.debitNoteNo,
    vendorId: row.vendorId,
    vendorName,
    reason: row.reason,
    linkedFailureLogId: row.linkedFailureLogId,
    amount: Number(row.amount) || 0,
    remainingBalance,
    attachmentUrl: row.attachmentUrl,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Sum of a set of debit notes' own usages, grouped by debitNoteId — one query for however
 * many notes are being enriched, rather than one query per note. */
async function usedAmountsByNoteId(orgId: string, noteIds: string[]): Promise<Map<string, number>> {
  const used = new Map<string, number>();
  if (noteIds.length === 0) return used;
  const rows = await db
    .select({ debitNoteId: debitNoteUsages.debitNoteId, amount: debitNoteUsages.amount })
    .from(debitNoteUsages)
    .where(and(eq(debitNoteUsages.orgId, orgId), inArray(debitNoteUsages.debitNoteId, noteIds)));
  for (const row of rows) {
    const current = used.get(row.debitNoteId) ?? 0;
    used.set(row.debitNoteId, round2(current + (Number(row.amount) || 0)));
  }
  return used;
}

async function enrichDebitNotes(orgId: string, rows: DebitNoteRow[]): Promise<DebitNoteRecord[]> {
  if (rows.length === 0) return [];

  const vendorIds = [...new Set(rows.map((r) => r.vendorId))];
  const vendorRows = await db
    .select()
    .from(vendors)
    .where(and(eq(vendors.orgId, orgId), inArray(vendors.id, vendorIds)));
  const nameById = new Map(vendorRows.map((v) => [v.id, v.vendorName]));

  const used = await usedAmountsByNoteId(orgId, rows.map((r) => r.id));

  return rows
    .map((row) => {
      const amount = Number(row.amount) || 0;
      const remaining = round2(amount - (used.get(row.id) ?? 0));
      return rowToDebitNote(row, nameById.get(row.vendorId) ?? "", remaining);
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** One debit note's own remaining balance — used by applyDebitNoteToBill()/
 * receiveDebitNotePayment() to validate before posting a new usage against it. */
async function remainingBalanceFor(orgId: string, noteId: string, amount: number): Promise<number> {
  const rows = await db
    .select({ amount: debitNoteUsages.amount })
    .from(debitNoteUsages)
    .where(and(eq(debitNoteUsages.orgId, orgId), eq(debitNoteUsages.debitNoteId, noteId)));
  const used = round2(rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0));
  return round2(amount - used);
}

// ---------------------------------------------------------------------------
// Create — against a vendor, optionally linked to one Failure Log entry
// ---------------------------------------------------------------------------

/**
 * REF-numbering, same "read the highest, add one, no retry loop" judgment call
 * creditNotes.ts's own allocateCreditNoteNumber() already made and documented —
 * `debit_notes.debitNoteNo` has no unique constraint backing it either, so a retry loop
 * here would be equally dead code. Same low-volume, human-triggered reasoning applies;
 * same real fix (a `unique(org_id, debit_note_no)` constraint) if this ever needs to be
 * airtight — a future schema change, not something to patch around here.
 */
async function allocateDebitNoteNumber(orgId: string): Promise<string> {
  const existing = await db
    .select({ debitNoteNo: debitNotes.debitNoteNo })
    .from(debitNotes)
    .where(eq(debitNotes.orgId, orgId));

  const pattern = /^DN-(\d+)$/;
  let maxNumber = 0;
  for (const row of existing) {
    const match = pattern.exec(row.debitNoteNo);
    if (match) maxNumber = Math.max(maxNumber, Number(match[1]));
  }
  return `DN-${String(maxNumber + 1).padStart(4, "0")}`;
}

export interface CreateDebitNoteInput {
  vendorId: string;
  amount: number;
  reason?: DebitNoteReason | string;
  /** When given, this Debit Note also marks that Failure Log entry as claimed
   * (`failure_log.debitNoteId`) — refused if that entry already has one (idempotency,
   * mirrors deviation.ts's own movedToInventoryAt guard). */
  linkedFailureLogId?: string;
  attachmentUrl?: string;
}

/**
 * Issues a Debit Note against a vendor and posts, atomically:
 * `Dr Vendor Claim Receivable amount / Cr Purchases Expense amount` — no vendor-price
 * auto-suggestion (amount is manually entered in full, per explicit product decision,
 * unlike Purchase's own PO-issue screen).
 */
export async function createDebitNote(
  input: CreateDebitNoteInput,
  createdBy: string
): Promise<DebitNoteRecord> {
  const orgId = await getTenantOrgId();
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new DebitNoteError("Amount 0 se zyada hona chahiye.");

  const vendor = await findById(vendors, orgId, input.vendorId);
  if (!vendor) throw new DebitNoteError("Vendor nahi mila.");

  let failureRow: InferSelectModel<typeof failureLog> | null = null;
  if (input.linkedFailureLogId) {
    failureRow = await findById(failureLog, orgId, input.linkedFailureLogId);
    if (!failureRow) throw new DebitNoteError("Linked Failure Log entry nahi mila.");
    if (failureRow.debitNoteId) {
      throw new DebitNoteError("Is Failure Log entry ke liye pehle hi ek Debit Note ban chuka hai.");
    }
  }

  const accounts = await listChartOfAccounts();
  const vendorClaimReceivable = accounts.find((a) => a.code === SYSTEM_ACCOUNT_CODES.VENDOR_CLAIM_RECEIVABLE);
  const purchasesExpense = accounts.find((a) => a.code === SYSTEM_ACCOUNT_CODES.PURCHASES_EXPENSE);
  if (!vendorClaimReceivable || !purchasesExpense) {
    throw new DebitNoteError("Chart of Accounts me zaroori system accounts nahi mile.");
  }

  const reason = (input.reason ?? "").trim();
  const debitNoteId = generateId("DBN");
  const debitNoteNo = await allocateDebitNoteNumber(orgId);
  const journalEntryId = generateId("JE");
  const entryDate = new Date();

  const debitNoteInsert = db.insert(debitNotes).values({
    id: debitNoteId,
    orgId,
    vendorId: input.vendorId,
    debitNoteNo,
    reason,
    linkedFailureLogId: input.linkedFailureLogId?.trim() ?? "",
    amount: String(amount),
    attachmentUrl: input.attachmentUrl?.trim() ?? "",
    createdBy,
  });

  const journalEntryInsert = db.insert(journalEntries).values({
    id: journalEntryId,
    orgId,
    entryDate,
    description: `Debit Note ${debitNoteNo} — Vendor ${vendor.vendorName}${reason ? ` (${reason})` : ""}`,
    sourceType: "DebitNote",
    sourceId: debitNoteId,
    createdBy,
  });

  const journalLinesInsert = db.insert(journalLines).values([
    { entryId: journalEntryId, orgId, lineNo: 1, accountId: vendorClaimReceivable.id, debit: String(amount), credit: "0" },
    { entryId: journalEntryId, orgId, lineNo: 2, accountId: purchasesExpense.id, debit: "0", credit: String(amount) },
  ]);

  // Same variable-length-batch shape confirmDispatch() (dispatch.ts) already uses via its
  // own `...orderItemUpdates` spread — a failureLog update only joins the batch when this
  // note is actually linked to one, so the note and its failure-log linkage can't
  // half-happen without inflating every unlinked Debit Note's own batch shape.
  const failureLogUpdate = failureRow
    ? [
        db
          .update(failureLog)
          .set({ debitNoteId })
          .where(and(eq(failureLog.orgId, orgId), eq(failureLog.id, failureRow.id))),
      ]
    : [];

  await db.batch([debitNoteInsert, journalEntryInsert, journalLinesInsert, ...failureLogUpdate]);

  const row = await findById(debitNotes, orgId, debitNoteId);
  if (!row) throw new DebitNoteError("Debit Note ban gaya lekin load nahi ho paya.");
  return rowToDebitNote(row, vendor.vendorName, amount);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listDebitNotes(): Promise<DebitNoteRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await listByOrg(debitNotes, orgId);
  return enrichDebitNotes(orgId, rows);
}

export async function listDebitNotesForVendor(vendorId: string): Promise<DebitNoteRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(debitNotes)
    .where(and(eq(debitNotes.orgId, orgId), eq(debitNotes.vendorId, vendorId)));
  return enrichDebitNotes(orgId, rows);
}

/** One debit note, enriched — backs the Apply/Receive dialogs' own detail fetch (they need
 * the note's vendorId to know which bills to offer for "Apply to a Bill"). */
export async function getDebitNote(debitNoteId: string): Promise<DebitNoteRecord | null> {
  const orgId = await getTenantOrgId();
  const row = await findById(debitNotes, orgId, debitNoteId);
  if (!row) return null;
  const enriched = await enrichDebitNotes(orgId, [row]);
  return enriched[0] ?? null;
}

/** Sum of all of one vendor's debit notes minus all usages against those notes — the
 * vendor's own total available claim, live-derived, never stored (same convention as every
 * other running balance in this codebase). */
export async function getVendorClaimBalance(vendorId: string): Promise<number> {
  const orgId = await getTenantOrgId();
  const noteRows = await db
    .select({ id: debitNotes.id, amount: debitNotes.amount })
    .from(debitNotes)
    .where(and(eq(debitNotes.orgId, orgId), eq(debitNotes.vendorId, vendorId)));
  if (noteRows.length === 0) return 0;

  const totalIssued = round2(noteRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0));
  const used = await usedAmountsByNoteId(orgId, noteRows.map((r) => r.id));
  const totalUsed = round2([...used.values()].reduce((sum, v) => sum + v, 0));
  return round2(totalIssued - totalUsed);
}

// ---------------------------------------------------------------------------
// Apply — a note's value becomes a real bill_payments row (mode "Debit_Note")
// ---------------------------------------------------------------------------

export interface ApplyDebitNoteInput {
  debitNoteId: string;
  billId: string;
  amount: number;
}

/**
 * Posts `Dr Accounts Payable / Cr Vendor Claim Receivable` and inserts a real
 * `bill_payments` row (mode "Debit_Note") — `recordBillPayment()` (payables.ts) never
 * transitions `bills.status` on a normal payment either (a Bill only ever has
 * Draft/Issued — paid/outstanding is read live from `bill_payments` vs `bills.amount`
 * wherever it's displayed, see getBill()'s own totalPaid), so inserting the payment row
 * directly here needs no extra status handling to stay consistent with that.
 */
export async function applyDebitNoteToBill(
  input: ApplyDebitNoteInput,
  createdBy: string
): Promise<DebitNoteRecord> {
  const orgId = await getTenantOrgId();
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new DebitNoteError("Amount 0 se zyada hona chahiye.");

  const noteRow = await findById(debitNotes, orgId, input.debitNoteId);
  if (!noteRow) throw new DebitNoteError("Debit Note nahi mila.");

  const remaining = await remainingBalanceFor(orgId, noteRow.id, Number(noteRow.amount) || 0);
  if (amount > remaining) {
    throw new DebitNoteError(`Is Debit Note ka sirf ₹${remaining} balance bacha hai.`);
  }

  const billDetail = await getBill(input.billId);
  if (!billDetail) throw new DebitNoteError("Bill nahi mili.");
  if (billDetail.bill.vendorId !== noteRow.vendorId) {
    throw new DebitNoteError("Ye Debit Note is bill ke vendor ka nahi hai.");
  }
  if (billDetail.bill.status !== "Issued") {
    throw new DebitNoteError("Sirf Issued bill par Debit Note apply ho sakta hai.");
  }

  const accounts = await listChartOfAccounts();
  const vendorClaimReceivable = accounts.find((a) => a.code === SYSTEM_ACCOUNT_CODES.VENDOR_CLAIM_RECEIVABLE);
  const accountsPayable = accounts.find((a) => a.code === SYSTEM_ACCOUNT_CODES.ACCOUNTS_PAYABLE);
  if (!vendorClaimReceivable || !accountsPayable) {
    throw new DebitNoteError("Chart of Accounts me zaroori system accounts nahi mile.");
  }

  const usageId = generateId("DNU");
  const journalEntryId = generateId("JE");
  const entryDate = new Date();

  const usageInsert = db.insert(debitNoteUsages).values({
    id: usageId,
    orgId,
    debitNoteId: noteRow.id,
    kind: "Applied",
    billId: input.billId,
    amount: String(amount),
    createdBy,
  });

  const paymentInsert = db.insert(billPayments).values({
    id: generateId("BPY"),
    orgId,
    billId: input.billId,
    amount: String(amount),
    mode: "Debit_Note",
    reference: noteRow.debitNoteNo,
    paidAt: entryDate,
    recordedBy: createdBy,
  });

  const journalEntryInsert = db.insert(journalEntries).values({
    id: journalEntryId,
    orgId,
    entryDate,
    description: `Debit Note ${noteRow.debitNoteNo} applied — Bill ${input.billId}`,
    sourceType: "DebitNoteUsage",
    sourceId: usageId,
    createdBy,
  });

  const journalLinesInsert = db.insert(journalLines).values([
    { entryId: journalEntryId, orgId, lineNo: 1, accountId: accountsPayable.id, debit: String(amount), credit: "0" },
    { entryId: journalEntryId, orgId, lineNo: 2, accountId: vendorClaimReceivable.id, debit: "0", credit: String(amount) },
  ]);

  await db.batch([usageInsert, paymentInsert, journalEntryInsert, journalLinesInsert]);

  const updatedNote = await findById(debitNotes, orgId, noteRow.id);
  if (!updatedNote) throw new DebitNoteError("Apply ho gaya lekin Debit Note load nahi ho paya.");
  const vendor = await findById(vendors, orgId, noteRow.vendorId);
  const newRemaining = await remainingBalanceFor(orgId, noteRow.id, Number(updatedNote.amount) || 0);
  return rowToDebitNote(updatedNote, vendor?.vendorName ?? "", newRemaining);
}

// ---------------------------------------------------------------------------
// Receive — a note's value paid to the org in real cash
// ---------------------------------------------------------------------------

export interface ReceiveDebitNotePaymentInput {
  debitNoteId: string;
  amount: number;
}

/** Posts `Dr Cash-Bank / Cr Vendor Claim Receivable` — the vendor pays the note's value
 * back in real cash instead of it being applied against a future Bill. */
export async function receiveDebitNotePayment(
  input: ReceiveDebitNotePaymentInput,
  createdBy: string
): Promise<DebitNoteRecord> {
  const orgId = await getTenantOrgId();
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new DebitNoteError("Amount 0 se zyada hona chahiye.");

  const noteRow = await findById(debitNotes, orgId, input.debitNoteId);
  if (!noteRow) throw new DebitNoteError("Debit Note nahi mila.");

  const remaining = await remainingBalanceFor(orgId, noteRow.id, Number(noteRow.amount) || 0);
  if (amount > remaining) {
    throw new DebitNoteError(`Is Debit Note ka sirf ₹${remaining} balance bacha hai.`);
  }

  const accounts = await listChartOfAccounts();
  const vendorClaimReceivable = accounts.find((a) => a.code === SYSTEM_ACCOUNT_CODES.VENDOR_CLAIM_RECEIVABLE);
  const cashAccount = accounts.find((a) => a.code === SYSTEM_ACCOUNT_CODES.CASH_BANK);
  if (!vendorClaimReceivable || !cashAccount) {
    throw new DebitNoteError("Chart of Accounts me zaroori system accounts nahi mile.");
  }

  const usageId = generateId("DNU");
  const journalEntryId = generateId("JE");
  const entryDate = new Date();

  const usageInsert = db.insert(debitNoteUsages).values({
    id: usageId,
    orgId,
    debitNoteId: noteRow.id,
    kind: "Received",
    amount: String(amount),
    createdBy,
  });

  const journalEntryInsert = db.insert(journalEntries).values({
    id: journalEntryId,
    orgId,
    entryDate,
    description: `Debit Note ${noteRow.debitNoteNo} received in cash`,
    sourceType: "DebitNoteUsage",
    sourceId: usageId,
    createdBy,
  });

  const journalLinesInsert = db.insert(journalLines).values([
    { entryId: journalEntryId, orgId, lineNo: 1, accountId: cashAccount.id, debit: String(amount), credit: "0" },
    { entryId: journalEntryId, orgId, lineNo: 2, accountId: vendorClaimReceivable.id, debit: "0", credit: String(amount) },
  ]);

  await db.batch([usageInsert, journalEntryInsert, journalLinesInsert]);

  const updatedNote = await findById(debitNotes, orgId, noteRow.id);
  if (!updatedNote) throw new DebitNoteError("Receive ho gaya lekin Debit Note load nahi ho paya.");
  const vendor = await findById(vendors, orgId, noteRow.vendorId);
  const newRemaining = await remainingBalanceFor(orgId, noteRow.id, Number(updatedNote.amount) || 0);
  return rowToDebitNote(updatedNote, vendor?.vendorName ?? "", newRemaining);
}
