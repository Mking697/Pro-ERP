import type { InferSelectModel } from "drizzle-orm";
import { and, eq, inArray, sql } from "drizzle-orm";
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

/** One credit note's own remaining balance — used only to build a human-readable error
 * message after `insertCreditNoteUsageIfBalanceAllows()` below refuses an over-application;
 * NOT used to gate the write itself anymore (that read-then-write shape had a real TOCTOU
 * race — see that function's own comment). A re-read here can be a beat stale under
 * concurrent load, but that only affects the wording of the error, never the money. */
async function remainingBalanceFor(orgId: string, noteId: string, amount: number): Promise<number> {
  const rows = await db
    .select({ amount: creditNoteUsages.amount })
    .from(creditNoteUsages)
    .where(and(eq(creditNoteUsages.orgId, orgId), eq(creditNoteUsages.creditNoteId, noteId)));
  const used = round2(rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0));
  return round2(amount - used);
}

/**
 * The real balance guard (2026-09-24) — a single atomic `INSERT ... SELECT ... WHERE`
 * statement: the usage row is only ever inserted when `credit_notes.amount - SUM(existing
 * usages) >= amount` holds, evaluated by Postgres itself as part of the one statement, not
 * read-then-checked-then-written from application code. This closes a real TOCTOU race that
 * `remainingBalanceFor()` alone could not: two concurrent applications against the same note
 * could previously both read a remaining balance that still looked sufficient before either
 * had committed its own usage row, jointly overdrawing the note past its face value.
 *
 * Deliberately NOT wrapped together with the payment/journal-entry writes in one
 * `db.batch()` — the neon-http driver has no real transactions and a batch cannot branch on
 * an earlier statement's own result (see src/db/client.ts's own comment), so there is no way
 * to make an entire batch conditionally no-op when this guard fails. This usage insert is
 * therefore its own, separate atomic statement, executed BEFORE the payment/journal batch;
 * only once it has actually inserted a row does the caller proceed to record the payment and
 * post the journal entry. The one gap this leaves (vs. the old single all-or-nothing batch):
 * if the guard succeeds but the follow-up batch then fails for an unrelated reason, the
 * usage row would exist without its matching payment/journal entry — an operational rarity
 * (a genuine mid-request failure between two back-to-back writes, not something a normal
 * concurrent "Apply" click can trigger), and still strictly safer than the money-losing race
 * this replaces. Returns whether a row was actually inserted.
 */
async function insertCreditNoteUsageIfBalanceAllows(
  orgId: string,
  noteId: string,
  usageId: string,
  kind: "Applied" | "Refunded",
  orderId: string,
  amount: number,
  createdBy: string
): Promise<boolean> {
  const inserted = await db
    .insert(creditNoteUsages)
    .select(
      sql`SELECT ${usageId}::text AS id, ${orgId}::text AS org_id, ${noteId}::text AS credit_note_id,
                 ${kind}::credit_note_usage_kind AS kind, ${orderId}::text AS order_id,
                 ${String(amount)}::numeric AS amount, ${createdBy}::text AS created_by, now() AS created_at
          WHERE (SELECT ${creditNotes.amount} FROM ${creditNotes} WHERE ${creditNotes.id} = ${noteId} AND ${creditNotes.orgId} = ${orgId})
              - COALESCE((SELECT SUM(${creditNoteUsages.amount}) FROM ${creditNoteUsages} WHERE ${creditNoteUsages.creditNoteId} = ${noteId} AND ${creditNoteUsages.orgId} = ${orgId}), 0)
              >= ${String(amount)}::numeric`
    )
    .returning({ id: creditNoteUsages.id });
  return inserted.length > 0;
}

// ---------------------------------------------------------------------------
// Create — against exactly one Issued invoice
// ---------------------------------------------------------------------------

/**
 * REF-numbering, same "read the highest, add one" shape as quotations.ts's own
 * allocateQuotationNumber()/dispatches.ts's own gate-pass allocator. `credit_notes` now
 * carries a real `unique(org_id, credit_note_no)` constraint (added 2026-09-24, alongside
 * the identical one on `debit_notes` — see src/db/schema/accounts.ts), so createCreditNote()
 * below retries this on a genuine collision rather than trusting a single fresh read to
 * never race, the same safety net quotations'/dispatches' own allocators rely on.
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

/** True for a Postgres unique-violation (23505) against the given constraint name — same
 * helper quotations.ts's own insertQuotationRow() uses for the identical retry reason. */
/** True for a Postgres unique-violation (23505) against the given constraint name — walks
 * the error's own `cause` chain, since drizzle-orm wraps the real driver error (which
 * carries `code`/`constraint`) inside a DrizzleQueryError whose own properties are only
 * query/params/cause; checking `error.code` directly never matches. */
function isUniqueViolation(error: unknown, constraintName: string): boolean {
  for (let current: unknown = error; current; current = (current as { cause?: unknown } | null)?.cause) {
    if (typeof current !== "object" || current === null) continue;
    const e = current as { code?: unknown; constraint?: unknown; message?: unknown };
    if (e.code === "23505") {
      if (typeof e.constraint === "string") return e.constraint === constraintName;
      return typeof e.message === "string" && e.message.includes(constraintName);
    }
  }
  return false;
}

const CREDIT_NOTE_NO_CONSTRAINT = "credit_notes_org_id_credit_note_no_unique";

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
  const journalEntryId = generateId("JE");
  const entryDate = new Date();

  // amount = revenueDebit + gstAmount by construction, and amount > 0, so at least one of
  // these two lines is always non-zero — postJournalEntry()'s own "every line non-zero"
  // rule (which this function doesn't call, but mirrors) is satisfied without extra checks.
  const revenueDebit = round2(amount - gstAmount);

  // Retry-on-collision, same shape as quotations.ts's own insertQuotationRow() and
  // dispatch.ts's own confirmDispatch() — creditNoteId/journalEntryId are reused across
  // attempts (safe: db.batch() is one atomic write, so a failed attempt commits nothing),
  // only creditNoteNo (and the entry description text that embeds it) is re-allocated fresh
  // each try.
  let committed = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const creditNoteNo = await allocateCreditNoteNumber(orgId);

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

    const lines: { entryId: string; orgId: string; lineNo: number; accountId: string; debit: string; credit: string }[] = [];
    if (revenueDebit > 0) {
      lines.push({ entryId: journalEntryId, orgId, lineNo: lines.length + 1, accountId: salesRevenue.id, debit: String(revenueDebit), credit: "0" });
    }
    if (gstAmount > 0) {
      lines.push({ entryId: journalEntryId, orgId, lineNo: lines.length + 1, accountId: gstPayable.id, debit: String(gstAmount), credit: "0" });
    }
    lines.push({ entryId: journalEntryId, orgId, lineNo: lines.length + 1, accountId: customerCreditBalance.id, debit: "0", credit: String(amount) });

    const journalLinesInsert = db.insert(journalLines).values(lines);

    try {
      await db.batch([creditNoteInsert, journalEntryInsert, journalLinesInsert]);
      committed = true;
      break;
    } catch (error) {
      if (!isUniqueViolation(error, CREDIT_NOTE_NO_CONSTRAINT) || attempt >= 4) throw error;
      // Two credit notes allocated the same number in the same instant — re-read the true
      // max (now including the row that just won the race) and try again.
    }
  }
  if (!committed) {
    throw new CreditNoteError("Credit Note number allocate nahi ho paya. Dobara try karein.");
  }

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

  const inserted = await insertCreditNoteUsageIfBalanceAllows(
    orgId,
    noteRow.id,
    usageId,
    "Applied",
    input.orderId,
    amount,
    createdBy
  );
  if (!inserted) {
    const remaining = await remainingBalanceFor(orgId, noteRow.id, Number(noteRow.amount) || 0);
    throw new CreditNoteError(`Is Credit Note ka sirf ₹${remaining} balance bacha hai.`);
  }

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

  await db.batch([paymentInsert, journalEntryInsert, journalLinesInsert]);

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

  const accounts = await listChartOfAccounts();
  const customerCreditBalance = accounts.find((a) => a.code === SYSTEM_ACCOUNT_CODES.CUSTOMER_CREDIT_BALANCE);
  const cashAccount = accounts.find((a) => a.code === SYSTEM_ACCOUNT_CODES.CASH_BANK);
  if (!customerCreditBalance || !cashAccount) {
    throw new CreditNoteError("Chart of Accounts me zaroori system accounts nahi mile.");
  }

  const usageId = generateId("CNU");
  const journalEntryId = generateId("JE");
  const entryDate = new Date();

  const inserted = await insertCreditNoteUsageIfBalanceAllows(orgId, noteRow.id, usageId, "Refunded", "", amount, createdBy);
  if (!inserted) {
    const remaining = await remainingBalanceFor(orgId, noteRow.id, Number(noteRow.amount) || 0);
    throw new CreditNoteError(`Is Credit Note ka sirf ₹${remaining} balance bacha hai.`);
  }

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

  await db.batch([journalEntryInsert, journalLinesInsert]);

  const updatedNote = await findById(creditNotes, orgId, noteRow.id);
  if (!updatedNote) throw new CreditNoteError("Refund ho gaya lekin Credit Note load nahi ho paya.");
  const customerRow = await findById(customers, orgId, noteRow.customerId);
  const newRemaining = await remainingBalanceFor(orgId, noteRow.id, Number(updatedNote.amount) || 0);
  return rowToCreditNote(updatedNote, customerRow?.customerName ?? "", newRemaining);
}
