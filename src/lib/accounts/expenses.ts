import type { InferSelectModel } from "drizzle-orm";
import { expenseEntries, journalEntries, journalLines } from "@/db/schema";
import { db } from "@/db/client";
import { findById, listByOrg } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { round2 } from "@/lib/leads/quotationMath";
import { SYSTEM_ACCOUNT_CODES, listChartOfAccounts } from "@/lib/accounts/ledger";

/**
 * Additional Payments (2026-09-24) — a one-off Cash/Bank expense NOT tied to any Sales
 * Order or Purchase Order (rent, salaries, utilities, misc.). See src/db/schema/accounts.ts's
 * own header comment on `expenseEntries` for the full design reasoning.
 *
 * Unlike Invoice/Bill (Draft -> Issued), there is no draft concept here: recording the
 * entry IS the final action, so the domain row and its journal entry post ATOMICALLY in one
 * `db.batch()` — this mirrors `confirmDispatch()`'s reasoning (the write itself is the
 * primary financial action and must not half-happen), not `issueInvoice()`'s
 * best-effort-after-the-fact posting (where the invoice was already saved as the real
 * document before the GL posting is even attempted).
 */

export class ExpenseError extends Error {}

export interface ExpenseEntryRecord {
  id: string;
  entryDate: string;
  categoryAccountId: string;
  /** The category account's own name, joined in here so the UI never needs a second
   * lookup per row. */
  categoryName: string;
  description: string;
  paidTo: string;
  amount: number;
  attachmentUrl: string;
  createdBy: string;
  createdAt: string;
}

type ExpenseEntryRow = InferSelectModel<typeof expenseEntries>;

function rowToExpenseEntry(row: ExpenseEntryRow, categoryName: string): ExpenseEntryRecord {
  return {
    id: row.id,
    entryDate: row.entryDate.toISOString(),
    categoryAccountId: row.categoryAccountId,
    categoryName,
    description: row.description,
    paidTo: row.paidTo,
    amount: Number(row.amount) || 0,
    attachmentUrl: row.attachmentUrl,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface CreateExpenseEntryInput {
  categoryAccountId: string;
  description?: string;
  paidTo?: string;
  amount: number;
  attachmentUrl?: string;
}

/**
 * Records a one-off expense and posts `Dr categoryAccountId / Cr Cash-Bank` for the same
 * amount, atomically. `postJournalEntry()` (ledger.ts) is deliberately NOT reused here —
 * it runs its own internal `db.batch()` for the entry+lines alone, which would commit
 * before (or independently of) the `expense_entries` row, reopening exactly the
 * half-saved-state risk this function exists to avoid. The 2-line entry built here is
 * trivially balanced by construction (both lines carry the same rounded `amount`), so
 * `postJournalEntry()`'s generic multi-line balance-checking isn't needed.
 */
export async function createExpenseEntry(
  input: CreateExpenseEntryInput,
  createdBy: string
): Promise<ExpenseEntryRecord> {
  const orgId = await getTenantOrgId();
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new ExpenseError("Amount 0 se zyada hona chahiye.");

  const accounts = await listChartOfAccounts(); // seeds the org's default accounts, then lists.
  const category = accounts.find((a) => a.id === input.categoryAccountId);
  if (!category) throw new ExpenseError("Category account nahi mila.");
  if (category.type !== "Expense") {
    throw new ExpenseError(`"${category.name}" ek Expense-type account nahi hai.`);
  }
  const cashAccount = accounts.find((a) => a.code === SYSTEM_ACCOUNT_CODES.CASH_BANK);
  if (!cashAccount) throw new ExpenseError("Cash/Bank account Chart of Accounts me nahi mila.");

  const expenseId = generateId("EXP");
  const entryId = generateId("JE");
  const entryDate = new Date();
  const paidTo = input.paidTo?.trim() ?? "";

  const expenseInsert = db.insert(expenseEntries).values({
    id: expenseId,
    orgId,
    entryDate,
    categoryAccountId: category.id,
    description: input.description?.trim() ?? "",
    paidTo,
    amount: String(amount),
    attachmentUrl: input.attachmentUrl?.trim() ?? "",
    createdBy,
  });

  const journalEntryInsert = db.insert(journalEntries).values({
    id: entryId,
    orgId,
    entryDate,
    description: `Expense ${expenseId} — ${category.name}${paidTo ? ` (${paidTo})` : ""}`,
    sourceType: "Expense",
    sourceId: expenseId,
    createdBy,
  });

  const journalLinesInsert = db.insert(journalLines).values([
    { entryId, orgId, lineNo: 1, accountId: category.id, debit: String(amount), credit: "0" },
    { entryId, orgId, lineNo: 2, accountId: cashAccount.id, debit: "0", credit: String(amount) },
  ]);

  await db.batch([expenseInsert, journalEntryInsert, journalLinesInsert]);

  const row = await findById(expenseEntries, orgId, expenseId);
  if (!row) throw new ExpenseError("Expense record ho gaya lekin load nahi ho paya.");
  return rowToExpenseEntry(row, category.name);
}

/** Org-scoped, newest first, each row enriched with its category account's own name. */
export async function listExpenseEntries(): Promise<ExpenseEntryRecord[]> {
  const orgId = await getTenantOrgId();
  const [rows, accounts] = await Promise.all([listByOrg(expenseEntries, orgId), listChartOfAccounts()]);
  const nameById = new Map(accounts.map((a) => [a.id, a.name]));

  return rows
    .map((row) => rowToExpenseEntry(row, nameById.get(row.categoryAccountId) ?? ""))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
