import type { InferSelectModel } from "drizzle-orm";
import { and, eq, gte, lte } from "drizzle-orm";
import { chartOfAccounts, journalEntries, journalLines } from "@/db/schema";
import { db } from "@/db/client";
import { insertRecord, listByOrg } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { round2 } from "@/lib/leads/quotationMath";
import { endOfIstDay, startOfIstDay } from "@/lib/timestamp";

/**
 * The General Ledger (2026-09-22) — real double-entry bookkeeping underneath the
 * Receivables (`invoices`/`order_payments`) and Payables (`bills`/`bill_payments`) seeds.
 * See src/db/schema/accounts.ts's own header comment for the full schema shape/reasoning.
 *
 * `seedDefaultChartOfAccounts()` is idempotent and is called lazily from every read/post
 * entry point in this file, rather than at org creation — this way an org created before
 * the GL existed (i.e. every org as of this build) still gets one on first real use,
 * without needing to touch `createOrganization()`.
 *
 * A journal entry always balances (sum debit = sum credit) — enforced here in
 * `postJournalEntry()`, never by a DB constraint (Postgres has no clean way to check a
 * cross-row sum at insert time for this shape). Every entry is posted from a real business
 * event via `sourceType`/`sourceId`, and is never edited or deleted afterwards — a
 * correction is its own new, reversing entry, matching this schema's append-only-timeline
 * convention everywhere else (`lead_activities`, `order_activities`, ...).
 */

export class LedgerError extends Error {}

export type AccountType = "Asset" | "Liability" | "Equity" | "Income" | "Expense";

/** Codes for the six seeded system accounts every auto-posting hook in this codebase
 * (Receivables' issueInvoice()/recordPayment(), Payables' issueBill()/recordBillPayment())
 * debits/credits by name — an Admin can add more accounts on top, but these six are
 * load-bearing and marked `isSystem: true` so they aren't casually deleted.
 *
 * GST_PAYABLE (added alongside orders.gstAmount/invoices.gstAmount) is where issueInvoice()
 * now books the GST portion of an invoice instead of folding it into Sales Revenue — GST
 * collected from a customer is money owed to the tax authority, not the org's own income,
 * so leaving it inside Revenue overstated income/profit by the full tax amount.
 *
 * PETTY_CASH (added alongside the Petty Cash Book, src/lib/accounts/pettyCash.ts) is a
 * second cash-like Asset account, separate from CASH_BANK — a small imprest fund topped up
 * from Cash/Bank and spent from directly, so it needs its own running balance rather than
 * mixing into the main account. RENT/SALARY/UTILITIES/MISC_EXPENSE (added alongside
 * Additional Payments, src/lib/accounts/expenses.ts) are the category accounts a one-off
 * non-order expense posts against — seeded up front since there's no Chart-of-Accounts
 * "add account" UI yet (a real, documented gap — see CLAUDE.md's accounting review notes).
 *
 * TRANSIT_LOSS_EXPENSE (added alongside Credit Notes, src/lib/accounts/creditNotes.ts) is
 * for goods lost/damaged in transit that neither insurance nor the transporter reimburses —
 * recorded as a plain Additional Payment against this category, same mechanism as Rent/
 * Salary/etc, no dedicated claim-tracking workflow in this v1.
 *
 * CUSTOMER_CREDIT_BALANCE (Liability) is what a Credit Note actually credits — deliberately
 * NOT Accounts Receivable itself: crediting AR directly would be correct only when the
 * original invoice is still outstanding, but a Credit Note can just as easily be issued
 * against an invoice that was already paid in full, in which case the business now owes the
 * customer real money back — a liability, not a reduction of an asset that's already zero.
 * Keeping this as its own account works uniformly for both cases; whether a credit note's
 * value is later applied to a new order's payment or refunded in cash is decided at the
 * point of use (creditNotes.ts), not at issuance. */
export const SYSTEM_ACCOUNT_CODES = {
  CASH_BANK: "1000",
  PETTY_CASH: "1050",
  ACCOUNTS_RECEIVABLE: "1100",
  ACCOUNTS_PAYABLE: "2000",
  GST_PAYABLE: "2100",
  CUSTOMER_CREDIT_BALANCE: "2200",
  SALES_REVENUE: "4000",
  PURCHASES_EXPENSE: "5000",
  RENT_EXPENSE: "5100",
  SALARY_EXPENSE: "5200",
  UTILITIES_EXPENSE: "5300",
  MISC_EXPENSE: "5400",
  TRANSIT_LOSS_EXPENSE: "5500",
} as const;

const DEFAULT_ACCOUNTS: { code: string; name: string; type: AccountType }[] = [
  { code: SYSTEM_ACCOUNT_CODES.CASH_BANK, name: "Cash / Bank", type: "Asset" },
  { code: SYSTEM_ACCOUNT_CODES.PETTY_CASH, name: "Petty Cash", type: "Asset" },
  { code: SYSTEM_ACCOUNT_CODES.ACCOUNTS_RECEIVABLE, name: "Accounts Receivable", type: "Asset" },
  { code: SYSTEM_ACCOUNT_CODES.ACCOUNTS_PAYABLE, name: "Accounts Payable", type: "Liability" },
  { code: SYSTEM_ACCOUNT_CODES.GST_PAYABLE, name: "GST Payable", type: "Liability" },
  {
    code: SYSTEM_ACCOUNT_CODES.CUSTOMER_CREDIT_BALANCE,
    name: "Customer Credit Balance",
    type: "Liability",
  },
  { code: SYSTEM_ACCOUNT_CODES.SALES_REVENUE, name: "Sales Revenue", type: "Income" },
  { code: SYSTEM_ACCOUNT_CODES.PURCHASES_EXPENSE, name: "Purchases / COGS", type: "Expense" },
  { code: SYSTEM_ACCOUNT_CODES.RENT_EXPENSE, name: "Rent Expense", type: "Expense" },
  { code: SYSTEM_ACCOUNT_CODES.SALARY_EXPENSE, name: "Salary Expense", type: "Expense" },
  { code: SYSTEM_ACCOUNT_CODES.UTILITIES_EXPENSE, name: "Utilities Expense", type: "Expense" },
  { code: SYSTEM_ACCOUNT_CODES.MISC_EXPENSE, name: "Miscellaneous Expense", type: "Expense" },
  { code: SYSTEM_ACCOUNT_CODES.TRANSIT_LOSS_EXPENSE, name: "Transit Loss Expense", type: "Expense" },
];

export interface ChartOfAccountRecord {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  isSystem: boolean;
  createdAt: string;
}

type ChartOfAccountRow = InferSelectModel<typeof chartOfAccounts>;

function rowToAccount(row: ChartOfAccountRow): ChartOfAccountRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    isSystem: row.isSystem,
    createdAt: row.createdAt.toISOString(),
  };
}

/** True for a Postgres unique-violation (23505) against the given constraint name — same
 * helper this codebase's other retry-on-collision call sites use (dispatch.ts's
 * confirmDispatch, quotations.ts's insertQuotationRow). */
function isUniqueViolation(error: unknown, constraintName: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; constraint?: unknown; message?: unknown };
  if (e.code !== "23505") return false;
  if (typeof e.constraint === "string") return e.constraint === constraintName;
  return typeof e.message === "string" && e.message.includes(constraintName);
}

/**
 * Idempotent — inserts only whichever of the five default accounts is still missing for
 * this org. Safe to call on every request; a race between two concurrent first-calls for
 * the same org is tolerated (the loser's insert hits the real
 * `chart_of_accounts_org_id_code_unique` constraint and is swallowed, not thrown).
 */
export async function seedDefaultChartOfAccounts(orgId: string): Promise<void> {
  const existing = await db.select().from(chartOfAccounts).where(eq(chartOfAccounts.orgId, orgId));
  const existingCodes = new Set(existing.map((r) => r.code));

  for (const account of DEFAULT_ACCOUNTS) {
    if (existingCodes.has(account.code)) continue;
    try {
      await insertRecord(chartOfAccounts, {
        id: generateId("ACC"),
        orgId,
        code: account.code,
        name: account.name,
        type: account.type,
        isSystem: true,
      });
    } catch (error) {
      if (!isUniqueViolation(error, "chart_of_accounts_org_id_code_unique")) throw error;
    }
  }
}

export async function listChartOfAccounts(): Promise<ChartOfAccountRecord[]> {
  const orgId = await getTenantOrgId();
  await seedDefaultChartOfAccounts(orgId);
  const rows = await listByOrg(chartOfAccounts, orgId);
  return rows.map(rowToAccount).sort((a, b) => a.code.localeCompare(b.code));
}

async function findAccountByCode(orgId: string, code: string): Promise<ChartOfAccountRow | null> {
  const rows = await db
    .select()
    .from(chartOfAccounts)
    .where(and(eq(chartOfAccounts.orgId, orgId), eq(chartOfAccounts.code, code)))
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Journal posting
// ---------------------------------------------------------------------------

export interface PostJournalLineInput {
  accountCode: string;
  debit?: number;
  credit?: number;
}

export interface PostJournalEntryInput {
  orgId: string;
  description: string;
  sourceType: string;
  sourceId: string;
  createdBy: string;
  /** Defaults to now — a manual/backdated adjustment can override it. */
  entryDate?: Date;
  lines: PostJournalLineInput[];
}

/**
 * Posts one balanced journal entry, atomically (entry header + every line, one
 * `db.batch()` call). Throws `LedgerError` — never posts a partial/unbalanced entry — if:
 * fewer than 2 lines, any line has both/neither of debit+credit set, any line's amount is
 * negative, an `accountCode` doesn't resolve, or `sum(debit) !== sum(credit)`.
 *
 * Every auto-posting hook in accounts.ts/payables.ts/orders.ts calls this wrapped in its
 * own try/catch (best-effort — see each call site's own comment for why); this function
 * itself has no best-effort behavior of its own, it either posts a fully valid entry or
 * throws.
 */
export async function postJournalEntry(input: PostJournalEntryInput): Promise<string> {
  if (input.lines.length < 2) {
    throw new LedgerError("Journal entry me kam se kam 2 lines honi chahiye.");
  }

  await seedDefaultChartOfAccounts(input.orgId);

  let totalDebit = 0;
  let totalCredit = 0;
  const resolvedLines: { accountId: string; debit: number; credit: number }[] = [];

  for (const line of input.lines) {
    const debit = round2(line.debit ?? 0);
    const credit = round2(line.credit ?? 0);
    if (debit < 0 || credit < 0) {
      throw new LedgerError("Debit ya Credit negative nahi ho sakta.");
    }
    if (debit > 0 && credit > 0) {
      throw new LedgerError("Ek journal line me sirf Debit ya sirf Credit ho sakta hai, dono nahi.");
    }
    if (debit === 0 && credit === 0) {
      throw new LedgerError("Har journal line me ek non-zero Debit ya Credit hona chahiye.");
    }

    const account = await findAccountByCode(input.orgId, line.accountCode);
    if (!account) {
      throw new LedgerError(`Account code "${line.accountCode}" Chart of Accounts me nahi mila.`);
    }

    resolvedLines.push({ accountId: account.id, debit, credit });
    totalDebit = round2(totalDebit + debit);
    totalCredit = round2(totalCredit + credit);
  }

  if (totalDebit !== totalCredit) {
    throw new LedgerError(
      `Journal entry balance nahi hai — total Debit ₹${totalDebit}, total Credit ₹${totalCredit}.`
    );
  }

  const entryId = generateId("JE");
  const entryInsert = db.insert(journalEntries).values({
    id: entryId,
    orgId: input.orgId,
    entryDate: input.entryDate ?? new Date(),
    description: input.description,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    createdBy: input.createdBy,
  });
  const lineInsert = db.insert(journalLines).values(
    resolvedLines.map((line, i) => ({
      entryId,
      orgId: input.orgId,
      lineNo: i + 1,
      accountId: line.accountId,
      debit: String(line.debit),
      credit: String(line.credit),
    }))
  );

  await db.batch([entryInsert, lineInsert]);
  return entryId;
}

// ---------------------------------------------------------------------------
// Reports — live-computed, never stored
// ---------------------------------------------------------------------------

export interface DateRange {
  /** ISO date/instant — inclusive lower bound on journal_entries.entry_date. */
  from?: string;
  /** ISO date/instant — inclusive upper bound on journal_entries.entry_date. */
  to?: string;
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  debit: number;
  credit: number;
}

/** Sum of debit/credit per account across every journal_line in range — the raw trial
 * balance, not netted. Every other report in this file (`getProfitAndLoss`,
 * `getBalanceSheet`) builds on this rather than re-querying journal_lines itself. */
export async function getTrialBalance(range?: DateRange): Promise<TrialBalanceRow[]> {
  const orgId = await getTenantOrgId();
  await seedDefaultChartOfAccounts(orgId);

  const accounts = await listByOrg(chartOfAccounts, orgId);
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  // `from`/`to` arrive as bare "YYYY-MM-DD" from the report boards' own <input type="date">
  // fields (src/app/accounts/ledger-board.tsx). Feeding that straight into `new Date(...)`
  // parses it as UTC midnight — 5:30am IST — which for an India-based org silently
  // excludes almost an entire business day from a "Balance Sheet as of today"/date-range
  // report, the same class of bug already found and fixed once in the recurring-task
  // generator (see src/lib/timestamp.ts's own header comment). Use the same IST-day-
  // boundary helpers that fix already established: `from` is the start of that IST day,
  // `to`/`asOf` is the END of that IST day (23:59:59.999 IST) so the range is inclusive of
  // the whole day, not just its first instant.
  const conditions = [eq(journalLines.orgId, orgId)];
  if (range?.from) conditions.push(gte(journalEntries.entryDate, startOfIstDay(range.from)));
  if (range?.to) conditions.push(lte(journalEntries.entryDate, endOfIstDay(range.to)));

  const rows = await db
    .select({
      accountId: journalLines.accountId,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(and(...conditions));

  const totals = new Map<string, { debit: number; credit: number }>();
  for (const row of rows) {
    const current = totals.get(row.accountId) ?? { debit: 0, credit: 0 };
    current.debit = round2(current.debit + (Number(row.debit) || 0));
    current.credit = round2(current.credit + (Number(row.credit) || 0));
    totals.set(row.accountId, current);
  }

  const result: TrialBalanceRow[] = [];
  for (const [accountId, totalsForAccount] of totals) {
    const account = accountById.get(accountId);
    if (!account) continue; // orphaned only if an account row was somehow deleted post-posting.
    result.push({
      accountId,
      code: account.code,
      name: account.name,
      type: account.type,
      debit: totalsForAccount.debit,
      credit: totalsForAccount.credit,
    });
  }
  return result.sort((a, b) => a.code.localeCompare(b.code));
}

export interface ProfitAndLossLine {
  code: string;
  name: string;
  amount: number;
}

export interface ProfitAndLoss {
  income: ProfitAndLossLine[];
  expense: ProfitAndLossLine[];
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
}

/** Income accounts increase with Credit, Expense accounts increase with Debit — each
 * line's `amount` is that account's own natural-balance net for the range. */
export async function getProfitAndLoss(range?: DateRange): Promise<ProfitAndLoss> {
  const trialBalance = await getTrialBalance(range);
  const income = trialBalance
    .filter((r) => r.type === "Income")
    .map((r) => ({ code: r.code, name: r.name, amount: round2(r.credit - r.debit) }));
  const expense = trialBalance
    .filter((r) => r.type === "Expense")
    .map((r) => ({ code: r.code, name: r.name, amount: round2(r.debit - r.credit) }));

  const totalIncome = round2(income.reduce((sum, r) => sum + r.amount, 0));
  const totalExpense = round2(expense.reduce((sum, r) => sum + r.amount, 0));
  return { income, expense, totalIncome, totalExpense, netProfit: round2(totalIncome - totalExpense) };
}

export interface BalanceSheetLine {
  code: string;
  name: string;
  amount: number;
}

export interface BalanceSheet {
  assets: BalanceSheetLine[];
  liabilities: BalanceSheetLine[];
  equity: BalanceSheetLine[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
}

/**
 * Assets vs Liabilities+Equity as of a date (all-time up to `asOf`, no lower bound —
 * a balance sheet is a snapshot, not a period).
 *
 * JUDGMENT CALL: this pass has no period-close/closing-entry mechanism (a real accounting
 * system would post accumulated Income/Expense into a Retained Earnings equity account at
 * each period end). Without one, Income/Expense balances would simply be left out of the
 * sheet and Assets would NOT equal Liabilities+Equity whenever the org has any net
 * profit/loss to date. Rather than ship a balance sheet that doesn't balance, this adds one
 * synthetic "Retained Earnings (Current)" equity line, computed live as this exact
 * range's net profit (getProfitAndLoss with the same `to` bound) — not a stored account,
 * not postable to directly, just the live-computed plug that keeps the identity true.
 */
export async function getBalanceSheet(asOf?: string): Promise<BalanceSheet> {
  const range: DateRange | undefined = asOf ? { to: asOf } : undefined;
  const trialBalance = await getTrialBalance(range);

  const assets = trialBalance
    .filter((r) => r.type === "Asset")
    .map((r) => ({ code: r.code, name: r.name, amount: round2(r.debit - r.credit) }));
  const liabilities = trialBalance
    .filter((r) => r.type === "Liability")
    .map((r) => ({ code: r.code, name: r.name, amount: round2(r.credit - r.debit) }));
  const equityAccounts = trialBalance
    .filter((r) => r.type === "Equity")
    .map((r) => ({ code: r.code, name: r.name, amount: round2(r.credit - r.debit) }));

  const pnl = await getProfitAndLoss(range);
  const equity: BalanceSheetLine[] = [
    ...equityAccounts,
    { code: "3900", name: "Retained Earnings (Current)", amount: pnl.netProfit },
  ];

  const totalAssets = round2(assets.reduce((sum, r) => sum + r.amount, 0));
  const totalLiabilities = round2(liabilities.reduce((sum, r) => sum + r.amount, 0));
  const totalEquity = round2(equity.reduce((sum, r) => sum + r.amount, 0));

  return { assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity };
}
