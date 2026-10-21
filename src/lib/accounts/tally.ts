import { and, eq, gte, lte } from "drizzle-orm";
import { chartOfAccounts, journalEntries, journalLines } from "@/db/schema";
import { db } from "@/db/client";
import { listByOrg } from "@/db/repo";
import { getTenant } from "@/lib/tenant";
import { seedDefaultChartOfAccounts } from "@/lib/accounts/ledger";
import { endOfIstDay, istDayKey, startOfIstDay } from "@/lib/timestamp";
import {
  serializeTallyExport,
  type TallyExportInput,
  type TallyExportResult,
  type TallyJournalLine,
  type TallyLedger,
  type TallyPostedJournal,
} from "@/lib/accounts/tally-export";

export class TallyGlExportError extends Error {}

export interface TallyGlExportRange {
  /** Inclusive, 'YYYY-MM-DD', read as an IST business day — same convention as every
   * other date-range report in this module (see ledger.ts's own getTrialBalance comment). */
  fromDate: string;
  toDate: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Converts a DB `numeric` rupee amount (always a decimal string over the wire, e.g.
 * `"123.40"` or `"0"`) into exact integer paise. Throws — never rounds — when the value
 * isn't a plain nonnegative decimal with at most 2 fractional digits of real precision: a
 * GL export silently redistributing a paisa is worse than failing loudly. `journal_lines`
 * never holds a negative debit/credit (enforced in `postJournalEntry()`), so this also
 * rejects negative input rather than silently taking an absolute value.
 */
export function rupeesToExactPaise(value: string, label: string): number {
  if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value.trim())) {
    throw new TallyGlExportError(`${label}: "${value}" ek valid nonnegative decimal amount nahi hai.`);
  }
  const [whole, frac = ""] = value.trim().split(".");
  // Anything beyond 2 decimal places must itself be exactly zero — a real third-decimal
  // value (e.g. "1.005") cannot be represented in paise without rounding, so it is
  // rejected rather than silently truncated/rounded.
  if (/[1-9]/.test(frac.slice(2))) {
    throw new TallyGlExportError(`${label}: "${value}" paise se zyada precision rakhta hai — exact paise conversion fail.`);
  }
  const paddedFrac = (frac + "00").slice(0, 2);
  const paise = Number(whole) * 100 + Number(paddedFrac);
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new TallyGlExportError(`${label}: "${value}" safe integer paise me convert nahi ho saka.`);
  }
  return paise;
}

/**
 * Builds a `serializeTallyExport()` input straight from the real Chart of Accounts /
 * General Ledger for the caller's own tenant — the DB-to-serializer boundary this file
 * exists for. Pure read, no writes (besides `seedDefaultChartOfAccounts()`'s own idempotent
 * lazy-seed, exactly like every other ledger.ts report already does).
 *
 * ACCOUNT TYPE MAPPING: `chart_of_accounts.type` (src/db/schema/accounts.ts's
 * `accountTypeEnum`) is already exactly the 5-value Tally type
 * (Asset/Liability/Equity/Income/Expense) — there is no separate subtype/category field in
 * this schema to map FROM, so the mapping is the identity function. This is the same
 * "coarse V1 classification" limitation tally-export.ts's own `GROUP_BY_TYPE` comment
 * already documents (e.g. every Asset lands under Tally's "Current Assets" group,
 * regardless of whether it's actually a fixed or current asset in this org's chart).
 *
 * POSTED JOURNALS: `journal_entries` has no Draft/Void status at all (see accounts.ts's
 * own schema header comment, and tally-export.ts's own "the GL has no Draft status" input
 * doc) — every row in this table already represents money actually posted via
 * `postJournalEntry()`, so no status filter is needed or possible; only the date range
 * itself is filtered (IST business day, inclusive, via `startOfIstDay`/`endOfIstDay` —
 * same helpers `getTrialBalance()` already uses and for the same reason: a bare UTC
 * midnight read would silently cut off the end of an India business day).
 */
export async function buildTallyGlExportInput(range: TallyGlExportRange): Promise<TallyExportInput> {
  if (!YMD.test(range.fromDate) || !YMD.test(range.toDate)) {
    throw new TallyGlExportError("fromDate/toDate 'YYYY-MM-DD' format me hona chahiye.");
  }

  const { orgId, org } = await getTenant();
  await seedDefaultChartOfAccounts(orgId);

  const accountRows = await listByOrg(chartOfAccounts, orgId);
  const ledgers: TallyLedger[] = accountRows.map((account) => ({
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
  }));

  const entryRows = await db
    .select({
      id: journalEntries.id,
      entryDate: journalEntries.entryDate,
      description: journalEntries.description,
      sourceType: journalEntries.sourceType,
      sourceId: journalEntries.sourceId,
    })
    .from(journalEntries)
    .where(and(
      eq(journalEntries.orgId, orgId),
      gte(journalEntries.entryDate, startOfIstDay(range.fromDate)),
      lte(journalEntries.entryDate, endOfIstDay(range.toDate))
    ));

  const lineRows = entryRows.length === 0 ? [] : await db
    .select({
      entryId: journalLines.entryId,
      lineNo: journalLines.lineNo,
      accountId: journalLines.accountId,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .where(eq(journalLines.orgId, orgId));

  const linesByEntry = new Map<string, typeof lineRows>();
  for (const line of lineRows) {
    const list = linesByEntry.get(line.entryId);
    if (list) list.push(line);
    else linesByEntry.set(line.entryId, [line]);
  }

  const postedJournals: TallyPostedJournal[] = entryRows.map((entry) => {
    const lines: TallyJournalLine[] = (linesByEntry.get(entry.id) ?? [])
      .slice()
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((line) => ({
        accountId: line.accountId,
        debitPaise: rupeesToExactPaise(line.debit, `Journal ${entry.id} line ${line.lineNo} debit`),
        creditPaise: rupeesToExactPaise(line.credit, `Journal ${entry.id} line ${line.lineNo} credit`),
      }));
    // sourceType/sourceId ("Invoice:INV-1", "Manual:", ...) — a manual entry has sourceId
    // "" (see ledger.ts's createManualJournalEntry), so fall back to sourceType alone, and
    // to the entry's own id only in the never-expected case both are empty too (the
    // serializer requires a nonempty reference on every journal).
    const reference = [entry.sourceType, entry.sourceId].filter(Boolean).join(":") || entry.id;
    return {
      id: entry.id,
      date: istDayKey(entry.entryDate),
      reference,
      narration: entry.description ?? "",
      lines,
    };
  });

  return {
    organizationId: orgId,
    organizationName: org.orgName,
    fromDate: range.fromDate,
    toDate: range.toDate,
    ledgers,
    postedJournals,
  };
}

/** Full DB → Tally-XML pipeline for one org/date-range — what the export API route calls. */
export async function generateTallyGlExport(range: TallyGlExportRange): Promise<TallyExportResult> {
  return serializeTallyExport(await buildTallyGlExportInput(range));
}
