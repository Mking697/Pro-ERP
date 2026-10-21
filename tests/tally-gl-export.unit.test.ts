import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

/**
 * A from-scratch, minimal fake of `@/db/client`'s `db.select().from().where()` — real
 * enough to evaluate the actual Drizzle `eq`/`gte`/`lte` conditions `tally.ts` builds
 * (not just `=`, unlike the simpler mock in finance-unit.test.ts, since this module's own
 * date-range filtering is exactly what several tests below exist to check), but with no
 * writes/transactions at all: `buildTallyGlExportInput()` never writes.
 */
const state = vi.hoisted(() => ({
  rows: {} as Record<string, Record<string, unknown>[]>,
}));

function parseConditions(table: unknown, sql: SQL) {
  const columns = getTableColumns(table as typeof schema.journalEntries);
  const query = new PgDialect().sqlToQuery(sql);
  const matches = [...query.sql.matchAll(/"(\w+)"\s*(>=|<=|=|>|<)\s*\$(\d+)/g)];
  return matches.map(([, colName, op, paramIdx]) => {
    const entry = Object.entries(columns).find(([, column]) => column.name === colName);
    if (!entry) throw new Error(`Unmapped column in test fixture: ${colName}`);
    return { key: entry[0], op, value: query.params[Number(paramIdx) - 1] };
  });
}

function asComparable(value: unknown): number | string {
  if (value instanceof Date) return value.getTime();
  // Drizzle's own query.params renders a Date bind parameter as an ISO string (what the
  // real postgres driver expects over the wire) — parse it back to compare against a row's
  // real Date the same way a timestamp column would, without misreading a genuine string
  // id/code (those never parse as a valid Date).
  if (typeof value === "string" && !Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return Date.parse(value);
  }
  return value as number | string;
}

function filterRows(table: unknown, tableName: string, where?: SQL) {
  const all = state.rows[tableName] ?? [];
  if (!where) return all;
  const conditions = parseConditions(table, where);
  return all.filter((row) =>
    conditions.every(({ key, op, value }) => {
      const a = asComparable(row[key]);
      const b = asComparable(value);
      switch (op) {
        case "=": return a === b;
        case ">=": return a >= b;
        case "<=": return a <= b;
        case ">": return a > b;
        case "<": return a < b;
        default: throw new Error(`Unsupported operator in test fixture: ${op}`);
      }
    })
  );
}

function builder(work: () => unknown) {
  return {
    then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
      return Promise.resolve().then(work).then(resolve, reject);
    },
  };
}

vi.mock("@/db/client", () => ({
  db: {
    select: (projection: Record<string, { name: string }>) => ({
      from: (table: unknown) => {
        let where: SQL | undefined;
        const tableName = table === schema.journalEntries ? "journal_entries" : "journal_lines";
        const query = Object.assign(
          builder(() => {
            const columns = getTableColumns(table as typeof schema.journalEntries);
            return filterRows(table, tableName, where).map((row) =>
              Object.fromEntries(
                Object.entries(projection).map(([key, col]) => {
                  const sourceKey = Object.entries(columns).find(([, c]) => c.name === col.name)![0];
                  return [key, row[sourceKey]];
                })
              )
            );
          }),
          { where: (condition: SQL) => { where = condition; return query; } }
        );
        return query;
      },
    }),
  },
}));

vi.mock("@/db/repo", () => ({
  listByOrg: async (table: unknown) => {
    const tableName = table === schema.chartOfAccounts ? "chart_of_accounts" : "unknown";
    return state.rows[tableName] ?? [];
  },
}));

vi.mock("@/lib/accounts/ledger", () => ({ seedDefaultChartOfAccounts: async () => {} }));

vi.mock("@/lib/tenant", () => ({
  getTenant: async () => ({ orgId: "ORG-1", org: { id: "ORG-1", orgName: "Example Works" } }),
}));

import { buildTallyGlExportInput, generateTallyGlExport, rupeesToExactPaise, TallyGlExportError } from "@/lib/accounts/tally";

function seed(tableName: string, row: Record<string, unknown>) {
  (state.rows[tableName] ??= []).push(row);
}

beforeEach(() => {
  state.rows = {};
  seed("chart_of_accounts", { id: "ACC-CASH", code: "1000", name: "Cash / Bank", type: "Asset", isSystem: true, orgId: "ORG-1" });
  seed("chart_of_accounts", { id: "ACC-RENT", code: "5100", name: "Rent Expense", type: "Expense", isSystem: true, orgId: "ORG-1" });
  seed("chart_of_accounts", { id: "ACC-SALES", code: "4000", name: "Sales Revenue", type: "Income", isSystem: true, orgId: "ORG-1" });
});

describe("rupeesToExactPaise", () => {
  it("converts whole and 2-decimal rupee strings exactly", () => {
    expect(rupeesToExactPaise("0", "x")).toBe(0);
    expect(rupeesToExactPaise("123", "x")).toBe(12300);
    expect(rupeesToExactPaise("123.4", "x")).toBe(12340);
    expect(rupeesToExactPaise("123.40", "x")).toBe(12340);
    expect(rupeesToExactPaise("0.05", "x")).toBe(5);
  });

  it("tolerates trailing zero sub-paise precision but rejects real sub-paise precision", () => {
    expect(rupeesToExactPaise("123.4000", "x")).toBe(12340);
    expect(() => rupeesToExactPaise("123.455", "x")).toThrow(TallyGlExportError);
    expect(() => rupeesToExactPaise("0.001", "x")).toThrow(/precision/);
  });

  it("rejects negative amounts and non-numeric garbage rather than coercing them", () => {
    expect(() => rupeesToExactPaise("-5", "x")).toThrow(TallyGlExportError);
    expect(() => rupeesToExactPaise("abc", "x")).toThrow(TallyGlExportError);
    expect(() => rupeesToExactPaise("", "x")).toThrow(TallyGlExportError);
  });
});

describe("buildTallyGlExportInput", () => {
  it("maps chart_of_accounts rows straight through as Tally ledgers (identity type mapping)", async () => {
    const input = await buildTallyGlExportInput({ fromDate: "2026-04-01", toDate: "2026-04-30" });
    expect(input.ledgers).toEqual([
      { id: "ACC-CASH", code: "1000", name: "Cash / Bank", type: "Asset" },
      { id: "ACC-RENT", code: "5100", name: "Rent Expense", type: "Expense" },
      { id: "ACC-SALES", code: "4000", name: "Sales Revenue", type: "Income" },
    ]);
    expect(input.organizationId).toBe("ORG-1");
    expect(input.organizationName).toBe("Example Works");
  });

  it("converts journal line amounts to exact paise and the entry date to its IST business day", async () => {
    // 2026-04-15T19:00:00.000Z is 2026-04-16 00:30 IST — the IST calendar day is the 16th,
    // not the 15th a naive UTC read would report.
    seed("journal_entries", { id: "JE-1", orgId: "ORG-1", entryDate: new Date("2026-04-15T19:00:00.000Z"), description: "April rent", sourceType: "Manual", sourceId: "" });
    seed("journal_lines", { entryId: "JE-1", orgId: "ORG-1", lineNo: 1, accountId: "ACC-RENT", debit: "123.40", credit: "0" });
    seed("journal_lines", { entryId: "JE-1", orgId: "ORG-1", lineNo: 2, accountId: "ACC-CASH", debit: "0", credit: "123.40" });

    const input = await buildTallyGlExportInput({ fromDate: "2026-04-01", toDate: "2026-04-30" });
    expect(input.postedJournals).toHaveLength(1);
    const journal = input.postedJournals[0];
    expect(journal.date).toBe("2026-04-16");
    expect(journal.reference).toBe("Manual");
    expect(journal.narration).toBe("April rent");
    expect(journal.lines).toEqual([
      { accountId: "ACC-RENT", debitPaise: 12340, creditPaise: 0 },
      { accountId: "ACC-CASH", debitPaise: 0, creditPaise: 12340 },
    ]);
  });

  it("includes only journal entries whose IST business day falls within [fromDate, toDate]", async () => {
    // Just before the range (IST day 2026-03-31), on each boundary, and just after it.
    seed("journal_entries", { id: "JE-BEFORE", orgId: "ORG-1", entryDate: new Date("2026-03-31T10:00:00.000Z"), description: "before", sourceType: "Manual", sourceId: "" });
    seed("journal_entries", { id: "JE-FROM", orgId: "ORG-1", entryDate: new Date("2026-04-01T04:00:00.000Z"), description: "on from boundary", sourceType: "Manual", sourceId: "" });
    seed("journal_entries", { id: "JE-TO", orgId: "ORG-1", entryDate: new Date("2026-04-30T18:00:00.000Z"), description: "on to boundary", sourceType: "Manual", sourceId: "" });
    seed("journal_entries", { id: "JE-AFTER", orgId: "ORG-1", entryDate: new Date("2026-04-30T19:00:00.000Z"), description: "after (rolls to May 1 IST)", sourceType: "Manual", sourceId: "" });
    for (const id of ["JE-BEFORE", "JE-FROM", "JE-TO", "JE-AFTER"]) {
      seed("journal_lines", { entryId: id, orgId: "ORG-1", lineNo: 1, accountId: "ACC-RENT", debit: "10.00", credit: "0" });
      seed("journal_lines", { entryId: id, orgId: "ORG-1", lineNo: 2, accountId: "ACC-CASH", debit: "0", credit: "10.00" });
    }

    const input = await buildTallyGlExportInput({ fromDate: "2026-04-01", toDate: "2026-04-30" });
    const ids = input.postedJournals.map((j) => j.id).sort();
    expect(ids).toEqual(["JE-FROM", "JE-TO"]);
  });

  it("builds a nonempty reference for a manual entry (empty sourceId) and a sourced one", async () => {
    seed("journal_entries", { id: "JE-MANUAL", orgId: "ORG-1", entryDate: new Date("2026-04-10T06:00:00.000Z"), description: "", sourceType: "Manual", sourceId: "" });
    seed("journal_entries", { id: "JE-INVOICE", orgId: "ORG-1", entryDate: new Date("2026-04-11T06:00:00.000Z"), description: "", sourceType: "Invoice", sourceId: "INV-1" });
    for (const [id, account] of [["JE-MANUAL", "ACC-RENT"], ["JE-INVOICE", "ACC-SALES"]] as const) {
      seed("journal_lines", { entryId: id, orgId: "ORG-1", lineNo: 1, accountId: account, debit: "5.00", credit: "0" });
      seed("journal_lines", { entryId: id, orgId: "ORG-1", lineNo: 2, accountId: "ACC-CASH", debit: "0", credit: "5.00" });
    }

    const input = await buildTallyGlExportInput({ fromDate: "2026-04-01", toDate: "2026-04-30" });
    const byId = new Map(input.postedJournals.map((j) => [j.id, j]));
    expect(byId.get("JE-MANUAL")?.reference).toBe("Manual");
    expect(byId.get("JE-INVOICE")?.reference).toBe("Invoice:INV-1");
  });

  it("rejects a malformed fromDate/toDate before touching the database", async () => {
    await expect(buildTallyGlExportInput({ fromDate: "2026/04/01", toDate: "2026-04-30" })).rejects.toThrow(TallyGlExportError);
    await expect(buildTallyGlExportInput({ fromDate: "2026-04-01", toDate: "not-a-date" })).rejects.toThrow(TallyGlExportError);
  });
});

describe("generateTallyGlExport", () => {
  it("produces real serialized Tally XML for a balanced posted journal", async () => {
    seed("journal_entries", { id: "JE-1", orgId: "ORG-1", entryDate: new Date("2026-04-15T06:00:00.000Z"), description: "April rent", sourceType: "Manual", sourceId: "" });
    seed("journal_lines", { entryId: "JE-1", orgId: "ORG-1", lineNo: 1, accountId: "ACC-RENT", debit: "100.00", credit: "0" });
    seed("journal_lines", { entryId: "JE-1", orgId: "ORG-1", lineNo: 2, accountId: "ACC-CASH", debit: "0", credit: "100.00" });

    const result = await generateTallyGlExport({ fromDate: "2026-04-01", toDate: "2026-04-30" });
    expect(result.ledgerCount).toBe(3);
    expect(result.voucherCount).toBe(1);
    expect(result.mastersXml).toContain("<REPORTNAME>All Masters</REPORTNAME>");
    expect(result.mastersXml).toContain("<NAME>Rent Expense</NAME>");
    expect(result.vouchersXml).toContain("<REPORTNAME>Vouchers</REPORTNAME>");
    expect(result.vouchersXml).toContain("<AMOUNT>-100.00</AMOUNT>");
  });

  it("throws rather than silently rounding when a stored amount has real sub-paise precision", async () => {
    seed("journal_entries", { id: "JE-BAD", orgId: "ORG-1", entryDate: new Date("2026-04-15T06:00:00.000Z"), description: "", sourceType: "Manual", sourceId: "" });
    seed("journal_lines", { entryId: "JE-BAD", orgId: "ORG-1", lineNo: 1, accountId: "ACC-RENT", debit: "10.005", credit: "0" });
    seed("journal_lines", { entryId: "JE-BAD", orgId: "ORG-1", lineNo: 2, accountId: "ACC-CASH", debit: "0", credit: "10.005" });

    await expect(generateTallyGlExport({ fromDate: "2026-04-01", toDate: "2026-04-30" })).rejects.toThrow(TallyGlExportError);
  });
});
