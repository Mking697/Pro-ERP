import type { InferSelectModel } from "drizzle-orm";
import { and, eq, sql } from "drizzle-orm";
import { journalEntries, journalLines, pettyCashEntries } from "@/db/schema";
import { db } from "@/db/client";
import { findById, listByOrg } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { round2 } from "@/lib/leads/quotationMath";
import {
  LedgerError,
  SYSTEM_ACCOUNT_CODES,
  listChartOfAccounts,
  type ChartOfAccountRecord,
} from "@/lib/accounts/ledger";

/**
 * The Petty Cash Book (2026-09-24) — a small imprest cash fund, separate from the main
 * Cash/Bank account. See src/db/schema/accounts.ts's own header comment on
 * `pettyCashEntries` for the full design reasoning.
 *
 * `topUpPettyCash()` posts its journal entry atomically alongside the domain row, in one
 * `db.batch()` — same reasoning as expenses.ts's own createExpenseEntry(): this write IS
 * the primary financial action (no Draft step to fall back on), so it must not half-happen.
 * `recordPettyCashExpense()` is deliberately different (2026-09-29) — its own domain-row
 * insert is a separate, atomically-guarded statement (`insertPettyCashExpenseIfBalanceAllows()`
 * below, mirroring credit_notes.ts's own `insertCreditNoteUsageIfBalanceAllows()`) executed
 * BEFORE the journal-entry batch, since only Postgres itself can safely evaluate "does the
 * fund's own live balance still cover this" at insert time — see that function's own comment.
 * `postJournalEntry()` (ledger.ts) is not reused by either path, for the same reason
 * expenses.ts doesn't reuse it — it runs its own separate, independently-committing
 * `db.batch()`.
 *
 * The running balance is NEVER stored — `getPettyCashBalance()` derives it live by summing
 * `journal_lines` for the Petty Cash account (debit increases it, credit decreases it),
 * matching `getTrialBalance()`'s own debit/credit-summing pattern in ledger.ts. This is the
 * same live computation `insertPettyCashExpenseIfBalanceAllows()` evaluates atomically before
 * allowing a payout.
 */

export class PettyCashError extends Error {}

export type PettyCashKind = "TopUp" | "Expense";

export interface PettyCashEntryRecord {
  id: string;
  entryDate: string;
  kind: PettyCashKind;
  counterAccountId: string;
  /** The counter account's own name, joined in here so the UI never needs a second
   * lookup per row (Cash/Bank for a TopUp, an Expense category for an Expense). */
  counterAccountName: string;
  description: string;
  amount: number;
  attachmentUrl: string;
  createdBy: string;
  createdAt: string;
  /** Running balance of the Petty Cash account AS OF (inclusive of) this entry — see this
   * file's own listPettyCashEntries() for how it's derived. */
  balanceAfter: number;
}

type PettyCashEntryRow = InferSelectModel<typeof pettyCashEntries>;

function rowToPettyCashEntry(
  row: PettyCashEntryRow,
  counterAccountName: string,
  balanceAfter: number
): PettyCashEntryRecord {
  return {
    id: row.id,
    entryDate: row.entryDate.toISOString(),
    kind: row.kind,
    counterAccountId: row.counterAccountId,
    counterAccountName,
    description: row.description,
    amount: Number(row.amount) || 0,
    attachmentUrl: row.attachmentUrl,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    balanceAfter,
  };
}

function findPettyCashAccount(accounts: ChartOfAccountRecord[]): ChartOfAccountRecord {
  const account = accounts.find((a) => a.code === SYSTEM_ACCOUNT_CODES.PETTY_CASH);
  if (!account) throw new PettyCashError("Petty Cash account Chart of Accounts me nahi mila.");
  return account;
}

/** Live sum of debit-minus-credit against one account's own journal_lines — the same
 * derived-never-stored pattern as stock on-hand / order-reserved / customer outstanding
 * elsewhere in this codebase, applied to a cash-like GL account instead of a stock/order
 * table. Debit increases an Asset account (Petty Cash is an Asset), credit decreases it. */
async function computeAccountBalance(orgId: string, accountId: string): Promise<number> {
  const rows = await db
    .select({ debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines)
    .where(and(eq(journalLines.orgId, orgId), eq(journalLines.accountId, accountId)));

  let balance = 0;
  for (const row of rows) {
    balance = round2(balance + (Number(row.debit) || 0) - (Number(row.credit) || 0));
  }
  return balance;
}

export async function getPettyCashBalance(): Promise<number> {
  const orgId = await getTenantOrgId();
  const accounts = await listChartOfAccounts();
  const pettyAccount = findPettyCashAccount(accounts);
  return computeAccountBalance(orgId, pettyAccount.id);
}

/**
 * The real balance guard (2026-09-29, mirroring credit_notes.ts's own
 * insertCreditNoteUsageIfBalanceAllows()) — a single atomic `INSERT ... SELECT ... WHERE`
 * statement: the expense row is only ever inserted when the Petty Cash account's own live
 * balance (SUM(debit) - SUM(credit) across journal_lines, the same computation
 * computeAccountBalance() does) still covers `amount`, evaluated by Postgres itself as part
 * of the one statement — not read-then-checked-then-written from application code. This
 * closes the exact TOCTOU race `recordPettyCashExpense()` used to carry (see its own header
 * comment, now removed): two concurrent expense recordings could previously both read a
 * sufficient balance before either had committed, jointly overdrawing the fund below zero.
 *
 * Deliberately NOT wrapped together with the journal-entry batch that follows, for the same
 * reason credit_notes.ts's own guard isn't — the neon-http driver has no real transactions
 * and a batch cannot branch on an earlier statement's own result (see src/db/client.ts's own
 * comment). This insert is therefore its own atomic statement, executed BEFORE the journal
 * batch; only once it has actually inserted a row does the caller proceed to post the journal
 * entry. Returns whether a row was actually inserted.
 */
async function insertPettyCashExpenseIfBalanceAllows(
  orgId: string,
  entryId: string,
  categoryAccountId: string,
  pettyAccountId: string,
  description: string,
  amount: number,
  attachmentUrl: string,
  createdBy: string
): Promise<boolean> {
  const inserted = await db
    .insert(pettyCashEntries)
    .select(
      sql`SELECT ${entryId}::text AS id, ${orgId}::text AS org_id, now() AS entry_date,
                 'Expense'::petty_cash_kind AS kind, ${categoryAccountId}::text AS counter_account_id,
                 ${description}::text AS description, ${String(amount)}::numeric AS amount,
                 ${attachmentUrl}::text AS attachment_url, ${createdBy}::text AS created_by, now() AS created_at
          WHERE COALESCE((SELECT SUM(${journalLines.debit}) - SUM(${journalLines.credit}) FROM ${journalLines}
                 WHERE ${journalLines.orgId} = ${orgId} AND ${journalLines.accountId} = ${pettyAccountId}), 0)
              >= ${String(amount)}::numeric`
    )
    .returning({ id: pettyCashEntries.id });
  return inserted.length > 0;
}

// ---------------------------------------------------------------------------
// Top Up — money INTO Petty Cash
// ---------------------------------------------------------------------------

export interface TopUpPettyCashInput {
  amount: number;
  description?: string;
  /** Defaults to the org's own Cash/Bank account when not given — an Admin can pick a
   * different source account only by deliberately supplying one. */
  sourceAccountId?: string;
  attachmentUrl?: string;
}

export async function topUpPettyCash(
  input: TopUpPettyCashInput,
  createdBy: string
): Promise<PettyCashEntryRecord> {
  const orgId = await getTenantOrgId();
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new PettyCashError("Amount 0 se zyada hona chahiye.");

  const accounts = await listChartOfAccounts();
  const pettyAccount = findPettyCashAccount(accounts);
  const sourceAccount = input.sourceAccountId
    ? accounts.find((a) => a.id === input.sourceAccountId)
    : accounts.find((a) => a.code === SYSTEM_ACCOUNT_CODES.CASH_BANK);
  if (!sourceAccount) throw new PettyCashError("Source account nahi mila.");

  const entryId = generateId("PCE");
  const journalEntryId = generateId("JE");
  const entryDate = new Date();

  const pceInsert = db.insert(pettyCashEntries).values({
    id: entryId,
    orgId,
    entryDate,
    kind: "TopUp",
    counterAccountId: sourceAccount.id,
    description: input.description?.trim() ?? "",
    amount: String(amount),
    attachmentUrl: input.attachmentUrl?.trim() ?? "",
    createdBy,
  });

  const journalEntryInsert = db.insert(journalEntries).values({
    id: journalEntryId,
    orgId,
    entryDate,
    description: `Petty Cash Top Up ${entryId} — from ${sourceAccount.name}`,
    sourceType: "PettyCash",
    sourceId: entryId,
    createdBy,
  });

  const linesInsert = db.insert(journalLines).values([
    { entryId: journalEntryId, orgId, lineNo: 1, accountId: pettyAccount.id, debit: String(amount), credit: "0" },
    { entryId: journalEntryId, orgId, lineNo: 2, accountId: sourceAccount.id, debit: "0", credit: String(amount) },
  ]);

  await db.batch([pceInsert, journalEntryInsert, linesInsert]);

  const row = await findById(pettyCashEntries, orgId, entryId);
  if (!row) throw new PettyCashError("Top Up ho gaya lekin load nahi ho paya.");
  const balanceAfter = await computeAccountBalance(orgId, pettyAccount.id);
  return rowToPettyCashEntry(row, sourceAccount.name, balanceAfter);
}

// ---------------------------------------------------------------------------
// Expense — money OUT of Petty Cash
// ---------------------------------------------------------------------------

export interface RecordPettyCashExpenseInput {
  categoryAccountId: string;
  description?: string;
  amount: number;
  attachmentUrl?: string;
}

/**
 * Refuses (LedgerError, matching this codebase's own error-class convention for a genuine
 * ledger-integrity violation rather than a plain input-validation mistake) if `amount`
 * exceeds the fund's own current balance — a petty cash fund can't pay out more than it
 * holds. The guard itself (`insertPettyCashExpenseIfBalanceAllows()` above) is a single
 * atomic `INSERT ... SELECT ... WHERE`, not a read-then-check-then-write — closing the TOCTOU
 * race this function used to carry (two concurrent expense recordings that both read a
 * sufficient balance before either committed could jointly overdraw the fund).
 */
export async function recordPettyCashExpense(
  input: RecordPettyCashExpenseInput,
  createdBy: string
): Promise<PettyCashEntryRecord> {
  const orgId = await getTenantOrgId();
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new PettyCashError("Amount 0 se zyada hona chahiye.");

  const accounts = await listChartOfAccounts();
  const pettyAccount = findPettyCashAccount(accounts);
  const category = accounts.find((a) => a.id === input.categoryAccountId);
  if (!category) throw new PettyCashError("Category account nahi mila.");
  if (category.type !== "Expense") {
    throw new PettyCashError(`"${category.name}" ek Expense-type account nahi hai.`);
  }

  const entryId = generateId("PCE");
  const journalEntryId = generateId("JE");
  const entryDate = new Date();

  const inserted = await insertPettyCashExpenseIfBalanceAllows(
    orgId,
    entryId,
    category.id,
    pettyAccount.id,
    input.description?.trim() ?? "",
    amount,
    input.attachmentUrl?.trim() ?? "",
    createdBy
  );
  if (!inserted) {
    const currentBalance = await computeAccountBalance(orgId, pettyAccount.id);
    throw new LedgerError(
      `Petty Cash balance kam hai — sirf ₹${currentBalance} available hai, ₹${amount} record nahi ho sakta.`
    );
  }

  const journalEntryInsert = db.insert(journalEntries).values({
    id: journalEntryId,
    orgId,
    entryDate,
    description: `Petty Cash Expense ${entryId} — ${category.name}`,
    sourceType: "PettyCash",
    sourceId: entryId,
    createdBy,
  });

  const linesInsert = db.insert(journalLines).values([
    { entryId: journalEntryId, orgId, lineNo: 1, accountId: category.id, debit: String(amount), credit: "0" },
    { entryId: journalEntryId, orgId, lineNo: 2, accountId: pettyAccount.id, debit: "0", credit: String(amount) },
  ]);

  await db.batch([journalEntryInsert, linesInsert]);

  const row = await findById(pettyCashEntries, orgId, entryId);
  if (!row) throw new PettyCashError("Expense record ho gaya lekin load nahi ho paya.");
  const balanceAfter = await computeAccountBalance(orgId, pettyAccount.id);
  return rowToPettyCashEntry(row, category.name, balanceAfter);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Org-scoped, newest first, each row enriched with its counter account's own name and a
 * running balance AS OF that entry. The running balance is reproduced by replaying entries
 * chronologically (each entry maps 1:1 to exactly one journal_lines row on the Petty Cash
 * account, posted by topUpPettyCash()/recordPettyCashExpense() above) rather than a second
 * journal_lines query per row — same numbers getPettyCashBalance()'s own summation would
 * give for the running total after the newest entry, just computed once for the whole list. */
export async function listPettyCashEntries(): Promise<PettyCashEntryRecord[]> {
  const orgId = await getTenantOrgId();
  const [rows, accounts] = await Promise.all([listByOrg(pettyCashEntries, orgId), listChartOfAccounts()]);
  const nameById = new Map(accounts.map((a) => [a.id, a.name]));

  const chronological = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const balanceById = new Map<string, number>();
  let running = 0;
  for (const row of chronological) {
    const amount = Number(row.amount) || 0;
    running = round2(running + (row.kind === "TopUp" ? amount : -amount));
    balanceById.set(row.id, running);
  }

  return rows
    .map((row) =>
      rowToPettyCashEntry(row, nameById.get(row.counterAccountId) ?? "", balanceById.get(row.id) ?? 0)
    )
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
