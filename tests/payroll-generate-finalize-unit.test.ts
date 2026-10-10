/* eslint-disable @typescript-eslint/no-explicit-any -- Minimal SQL-ish in-memory fake DB mirroring tests/fms-maintenance.unit.test.ts's pattern; application code stays fully typed. */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;

const s = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
  settings: {} as Record<string, string>,
  users: [] as Row[],
  fault: "",
}));

vi.mock("@/db/client", async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  const active = new AsyncLocalStorage<boolean>();
  let queue = Promise.resolve();
  const { getTableName } = await import("drizzle-orm");

  const evaluate = (node: any, row: Row): any => {
    if (node?.queryChunks) {
      const chunks = node.queryChunks;
      const text = chunks.map((c: any) => c.value?.join?.("") ?? "").join("");
      if (text.includes(" = ")) return evaluate(chunks[1], row) === evaluate(chunks[3], row);
      if (text.includes(" and ")) return chunks.filter((c: any) => c.queryChunks).every((c: any) => evaluate(c, row));
      if (text === "()") return evaluate(chunks[1], row);
      if (chunks.length === 1) return evaluate(chunks[0], row);
    }
    if (node?.table && node?.name) return row[node.name];
    if (node && "value" in node) return node.value;
    return node;
  };
  const domainRow = (row: Row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase()), v]));

  const colKey = (table: any, col: any): string | undefined => {
    for (const k of Object.keys(table)) if (table[k] === col) return k;
    return undefined;
  };

  const rowsOf = (name: string) => (s.rows[name] ??= []);

  const selectUpdateDelete = (table: any, operation: "select" | "update" | "delete", fields?: Row) => {
    const name = getTableName(table);
    let predicate: any;
    let limitN: number | undefined;
    const builder: any = {
      where(p: any) {
        predicate = p;
        return builder;
      },
      limit(n: number) {
        limitN = n;
        return builder;
      },
      returning() {
        return builder;
      },
      async then(resolve: any, reject: any) {
        try {
          if (s.fault === operation + ":" + name) throw new Error("injected " + s.fault);
          const rows = rowsOf(name);
          let matched = rows.filter((row) => !predicate || evaluate(predicate, domainRow(row)));
          if (operation === "update") matched.forEach((row) => Object.assign(row, fields));
          if (operation === "delete") s.rows[name] = rows.filter((row) => !matched.includes(row));
          if (limitN !== undefined) matched = matched.slice(0, limitN);
          resolve(matched.map((row) => structuredClone(row)));
        } catch (e) {
          reject(e);
        }
      },
    };
    return builder;
  };

  const insertBuilder = (table: any) => {
    const name = getTableName(table);
    let valuesObj: Row = {};
    let conflict: { type: "doNothing" | "doUpdate"; target: any[]; set?: Row } | undefined;
    const builder: any = {
      values(v: Row) {
        valuesObj = v;
        return builder;
      },
      onConflictDoNothing(opts: { target: any[] }) {
        conflict = { type: "doNothing", target: opts.target };
        return builder;
      },
      onConflictDoUpdate(opts: { target: any[]; set: Row }) {
        conflict = { type: "doUpdate", target: opts.target, set: opts.set };
        return builder;
      },
      async returning() {
        if (s.fault === "insert:" + name) throw new Error("injected " + s.fault);
        const rows = rowsOf(name);
        let existing: Row | undefined;
        if (conflict) {
          existing = rows.find((row) => conflict!.target.every((col) => row[colKey(table, col)!] === valuesObj[colKey(table, col)!]));
        }
        if (existing) {
          if (conflict!.type === "doNothing") return [];
          Object.assign(existing, conflict!.set);
          return [structuredClone(existing)];
        }
        const row: Row = {
          createdAt: new Date(),
          generatedAt: new Date(),
          finalizedAt: null,
          finalizedBy: "",
          pdfUrl: "",
          ...valuesObj,
        };
        rows.push(row);
        return [structuredClone(row)];
      },
    };
    return builder;
  };

  return {
    db: {
      select: () => ({ from: (table: any) => selectUpdateDelete(table, "select") }),
      update: (table: any) => ({ set: (fields: Row) => selectUpdateDelete(table, "update", fields) }),
      delete: (table: any) => selectUpdateDelete(table, "delete"),
      insert: (table: any) => insertBuilder(table),
    },
    async runInTenantTransaction<T>(_org: string, work: () => Promise<T>): Promise<T> {
      if (active.getStore()) return work();
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((r) => (release = r));
      await previous;
      const snapshot = structuredClone(s.rows);
      try {
        return await active.run(true, work);
      } catch (e) {
        s.rows = snapshot;
        throw e;
      } finally {
        release();
      }
    },
    isInTenantTransaction: () => !!active.getStore(),
  };
});

vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "org" }));
vi.mock("@/lib/auth/users", () => ({ listUsers: async () => s.users }));
vi.mock("@/lib/settings", () => ({
  getAllSettings: async () => s.settings,
  getSetting: async () => null,
}));
vi.mock("@/lib/platform/registry", () => ({ getOrganization: async () => null }));
vi.mock("@/lib/storage", () => ({ uploadAttachment: async () => ({ url: "" }) }));
vi.mock("@/lib/payroll/payslipPdf", () => ({ renderPayslipPdfBuffer: async () => Buffer.from("") }));

import { generatePayrollRun, finalizePayrollRun, getPayrollRun } from "@/lib/payroll/payroll";

const MONTH = "2026-03"; // 31 days

function seedUser(overrides: Partial<Row> = {}): Row {
  const user = {
    User_ID: "U1",
    Full_Name: "Test Employee",
    Role: "Employee",
    Status: "Inactive", // legacy inactive, no deactivatedAt -> 0 employed days by default
    Created_At: "2020-01-01T00:00:00.000Z",
    Deactivated_At: null,
    ...overrides,
  };
  s.users = [user];
  return user;
}

function seedSalary(monthlySalary: number, effectiveFrom = "2020-01-01") {
  s.rows.salary_structures.push({
    id: "SAL1",
    orgId: "org",
    userId: "U1",
    monthlySalary: String(monthlySalary),
    effectiveFrom,
    createdBy: "tester",
    createdAt: new Date("2020-01-01"),
  });
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

beforeEach(() => {
  s.rows = Object.fromEntries(["payroll_runs", "payslips", "salary_structures"].map((n) => [n, []]));
  s.settings = {};
  s.users = [];
  s.fault = "";
});

describe("zero/partial-pay deduction safety (OPS-02)", () => {
  it("never produces a negative net pay when grossPay is zero and PF is enabled", async () => {
    // Reproduces the exact finding: monthlySalary=20000, grossPay=0 (no employed days this
    // month), PF enabled -> old code: pfEmployee=1800 flat, netPay = 0 - 1800 = -1800.
    seedUser({ Status: "Inactive", Deactivated_At: null }); // 0 days employed
    seedSalary(20000);
    s.settings.PF_ENABLED = "true";

    const { payslips } = await generatePayrollRun(MONTH, "tester");
    const slip = payslips.find((p) => p.userId === "U1");
    expect(slip).toBeDefined();
    expect(slip!.grossPay).toBe(0);
    expect(slip!.daysEmployed).toBe(0);

    // The core safety property: whatever was computed, actual withheld deductions never
    // exceed what was actually earned, and net pay is never negative.
    expect(slip!.pfEmployee).toBe(0); // fully capped — nothing was earned to withhold from
    expect(slip!.netPay).toBe(0);
    expect(slip!.netPay).toBeGreaterThanOrEqual(0);
    // The shortfall must be reported explicitly, not silently absorbed.
    expect((slip as any).deductionShortfall).toBe(1800);
  });

  it("caps deductions proportionally (not silently) for a partial-pay period", async () => {
    // 2 employed days out of 31 -> small grossPay that PF's flat ceiling-capped amount
    // would exceed if left uncapped.
    seedUser({
      Status: "Active",
      Created_At: "2026-03-30T00:00:00.000Z", // joined 2 days before month end
    });
    seedSalary(20000);
    s.settings.PF_ENABLED = "true";
    s.settings.ESI_ENABLED = "true";

    const { payslips } = await generatePayrollRun(MONTH, "tester");
    const slip = payslips.find((p) => p.userId === "U1")!;
    expect(slip.daysEmployed).toBe(2);
    expect(slip.grossPay).toBeGreaterThan(0);
    expect(slip.grossPay).toBeLessThan(1800); // less than PF's uncapped flat amount

    expect(slip.netPay).toBeGreaterThanOrEqual(0);
    expect(round2(slip.pfEmployee + slip.esiEmployee)).toBeLessThanOrEqual(round2(slip.grossPay) + 0.01);
    expect((slip as any).deductionShortfall).toBeGreaterThan(0);
    // Proportional, not priority-order: ESI isn't starved to zero just because PF comes first.
    expect(slip.esiEmployee).toBeGreaterThan(0);
    expect(slip.pfEmployee).toBeGreaterThan(0);
  });

  it("applies zero deductions and full net pay when no statutory flag is enabled (unchanged v1 behavior)", async () => {
    seedUser({ Status: "Active", Created_At: "2020-01-01T00:00:00.000Z" });
    seedSalary(20000);

    const { payslips } = await generatePayrollRun(MONTH, "tester");
    const slip = payslips.find((p) => p.userId === "U1")!;
    expect(slip.pfEmployee).toBe(0);
    expect(slip.netPay).toBe(slip.grossPay);
    expect((slip as any).deductionShortfall).toBe(0);
  });
});

describe("durable deduction shortfall roundtrip (DB-free transport)", () => {
  it("reloads the persisted numeric shortfall independently of generation response and current settings", async () => {
    seedUser();
    seedSalary(20000);
    s.settings.PF_ENABLED = "true";
    const generated = await generatePayrollRun(MONTH, "tester");
    expect(s.rows.payslips[0].deductionShortfall).toBe("1800");
    generated.payslips[0].deductionShortfall = -1;
    s.settings = {};
    expect((await getPayrollRun(generated.run.id))!.payslips[0].deductionShortfall).toBe(1800);
  });

  it("regeneration updates the stored shortfall instead of leaving the old snapshot", async () => {
    seedUser();
    seedSalary(20000);
    s.settings.PF_ENABLED = "true";
    const first = await generatePayrollRun(MONTH, "tester");
    expect(s.rows.payslips[0].deductionShortfall).toBe("1800");
    s.settings = {};
    await generatePayrollRun(MONTH, "regenerator");
    expect(s.rows.payslips).toHaveLength(1);
    expect(s.rows.payslips[0].deductionShortfall).toBe("0");
    expect((await getPayrollRun(first.run.id))!.payslips[0].deductionShortfall).toBe(0);
  });

  it("finalization passes the persisted shortfall to the PDF renderer, not recomputed settings", async () => {
    seedUser();
    seedSalary(20000);
    s.settings.PF_ENABLED = "true";
    const { run } = await generatePayrollRun(MONTH, "tester");
    s.settings = {};
    const pdf = await import("@/lib/payroll/payslipPdf");
    const spy = vi.spyOn(pdf, "renderPayslipPdfBuffer");
    try {
      await finalizePayrollRun(run.id, "finalizer");
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ deductionShortfall: 1800, netPay: 0 }));
    } finally { spy.mockRestore(); }
  });
});

describe("generate/finalize serialized write boundary (OPS-02)", () => {
  it("a second finalize on an already-finalized run rejects cleanly without reprocessing", async () => {
    seedUser({ Status: "Active", Created_At: "2020-01-01T00:00:00.000Z" });
    seedSalary(20000);
    const { run } = await generatePayrollRun(MONTH, "tester");

    const first = await finalizePayrollRun(run.id, "tester-1");
    expect(first.status).toBe("Finalized");
    expect(first.finalizedBy).toBe("tester-1");

    await expect(finalizePayrollRun(run.id, "tester-2")).rejects.toThrow(/Finalized/);
    // The already-finalized run's finalizedBy must remain untouched by the rejected attempt.
    const stillOwned = s.rows.payroll_runs.find((r) => r.id === run.id)!;
    expect(stillOwned.finalizedBy).toBe("tester-1");
  });

  it("concurrent finalize calls for the same run cannot both succeed (serialized, not double-processed)", async () => {
    seedUser({ Status: "Active", Created_At: "2020-01-01T00:00:00.000Z" });
    seedSalary(20000);
    const { run } = await generatePayrollRun(MONTH, "tester");

    const results = await Promise.allSettled([
      finalizePayrollRun(run.id, "racer-1"),
      finalizePayrollRun(run.id, "racer-2"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const finalRow = s.rows.payroll_runs.find((r) => r.id === run.id)!;
    expect(finalRow.status).toBe("Finalized");
    // Whichever racer actually committed is the one that stuck — no silent overwrite by
    // the loser, no corrupted mixed state.
    const winnerBy = (fulfilled[0] as PromiseFulfilledResult<any>).value.finalizedBy;
    expect(finalRow.finalizedBy).toBe(winnerBy);
  });

  it("concurrent generate calls for the same month are serialized, not duplicated", async () => {
    seedUser({ Status: "Active", Created_At: "2020-01-01T00:00:00.000Z" });
    seedSalary(20000);

    const [a, b] = await Promise.all([
      generatePayrollRun(MONTH, "gen-1"),
      generatePayrollRun(MONTH, "gen-2"),
    ]);
    // Same run (month is unique per org) — not two separate Draft rows.
    expect(a.run.id).toBe(b.run.id);
    expect(s.rows.payroll_runs.filter((r) => r.month === MONTH)).toHaveLength(1);
    // Exactly one payslip for the one seeded user, not duplicated.
    expect(s.rows.payslips.filter((p) => p.payrollRunId === a.run.id)).toHaveLength(1);
  });
});
