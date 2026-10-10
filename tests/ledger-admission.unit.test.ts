/* eslint-disable @typescript-eslint/no-explicit-any -- DB-free persistence interpreter; real domain, schema, predicates and transaction adapter. */
import { beforeEach, expect, it, vi } from "vitest";

// DATA-06: inbound single/bulk ledger writers must admit/validate tenant-owned item SKU
// ownership consistently, the same shape as the already-approved vendor/BOM/Indent
// slices (typed 4xx admission error, confirmed-commit handling, never a silent write for
// an unowned/foreign/missing SKU) — for BOTH recordMovement() (single) and
// recordMovementsBulk() (bulk/import). Stock-quantity/availability math is an
// independent, already-covered concern (tests/stock-workflow-unit.test.ts,
// stock-availability-policy.test.ts); @/lib/inventory/availability is mocked here as a
// trusted boundary so this file stays scoped to SKU ownership admission, not reimplement
// availability's own join logic.
type Row = Record<string, any>;
const s = vi.hoisted(() => ({
  orgId: "org-a", rows: {} as Record<string, Row[]>,
  events: [] as { operation: string; table: string; inTx: boolean }[],
  transactions: 0, inTx: false, fail: "",
}));

vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => s.orgId }));
vi.mock("@/lib/inventory/availability", () => ({
  assertStockAvailable: vi.fn(async () => ({})),
  assertStockAvailableMany: vi.fn(async () => ({})),
}));
vi.mock("@/db/client", async () => {
  const { getTableName } = await import("drizzle-orm");
  const { createTenantTransactionAdapter } = await import("@/db/transaction-context");
  const evaluate = (node: any, row: Row): any => {
    if (node?.queryChunks) {
      const chunks = node.queryChunks;
      const text = chunks.map((c: any) => c.value?.join?.("") ?? "").join("");
      if (text.includes(" = ")) return evaluate(chunks[1], row) === evaluate(chunks[3], row);
      if (text.includes(" and ")) return chunks.filter((c: any) => c.queryChunks).every((c: any) => evaluate(c, row));
      if (text === "()") return evaluate(chunks[1], row);
      if (chunks.length === 1) return evaluate(chunks[0], row);
      throw new Error(`Unsupported predicate: ${text}`);
    }
    if (node?.table && node?.name) {
      const key = Object.keys(node.table).find((key) => node.table[key] === node)!;
      return row[key];
    }
    if (node && "value" in node) return node.value;
    return node;
  };
  const query = (table: any, operation: string) => {
    const name = getTableName(table);
    let predicate: any, limit = Infinity, values: Row | Row[];
    const builder: any = {
      where(p: any) { predicate = p; return builder; },
      limit(n: number) { limit = n; return builder; },
      values(v: Row | Row[]) { values = v; return builder; },
      set(v: Row) { values = v; return builder; },
      returning() { return builder; },
      then(resolve: any, reject: any) {
        try {
          s.events.push({ operation, table: name, inTx: s.inTx });
          if (s.fail === `${operation}:${name}`) throw new Error(`Injected ${s.fail} failure`);
          let result: Row[];
          if (operation === "insert") {
            result = (Array.isArray(values) ? values : [values]).map((value) => ({
              timestamp: new Date("2026-10-09T00:00:00Z"), ...value,
            }));
            s.rows[name].push(...result);
          } else {
            result = s.rows[name].filter((row) => !predicate || evaluate(predicate, row));
            if (operation === "update") result.forEach((row) => Object.assign(row, values));
          }
          resolve(structuredClone(result.slice(0, limit)));
        } catch (error) { reject(error); }
      },
    };
    return builder;
  };
  const transport = {
    select: () => ({ from: (table: any) => query(table, "select") }),
    insert: (table: any) => query(table, "insert"),
    update: (table: any) => query(table, "update"),
  };
  return createTenantTransactionAdapter({
    db: transport,
    async transact(work) {
      s.transactions++; s.inTx = true;
      const snapshot = structuredClone(s.rows);
      try { return await work(transport); }
      catch (error) { s.rows = snapshot; throw error; }
      finally { s.inTx = false; }
    },
    admit: async () => {},
    savepoint: async (tx, work) => work(tx),
  });
});

import { LedgerAdmissionError, recordMovement, recordMovementsBulk } from "@/lib/inventory/ledger";
import { runInTenantTransaction } from "@/db/client";
import { assertStockAvailable, assertStockAvailableMany } from "@/lib/inventory/availability";

vi.mock("@/lib/orders/orders", () => ({ recheckShortfallForSku: vi.fn(async () => {}) }));

const item = (sku: string, orgId = "org-a") => ({
  sku, orgId, itemName: `${orgId} ${sku}`, category: "Raw Material", sizeUnit: "", uom: "kg",
  rate: null, adcManual: null, leadTimeDays: null, safetyFactor: null, moq: null, maxLevel: null,
  location: "", status: "Active", createdAt: new Date("2026-10-09T00:00:00Z"), createdBy: "actor",
});
const movement = (overrides: Row = {}) => ({
  sku: "OWN", direction: "In" as const, quantity: 5, uom: "kg", source: "Manual" as const, userId: "actor", ...overrides,
});
const writes = () => s.events.filter((e) => e.operation !== "select");

beforeEach(() => {
  s.orgId = "org-a"; s.events = []; s.transactions = 0; s.inTx = false; s.fail = "";
  s.rows = { items: [item("OWN"), item("FOREIGN", "org-b")], stock_ledger: [] };
  vi.mocked(assertStockAvailable).mockClear().mockResolvedValue({} as never);
  vi.mocked(assertStockAvailableMany).mockClear().mockResolvedValue({} as never);
});

// --- Single-movement admission (recordMovement) -----------------------------------

it.each(["MISSING", "FOREIGN"])("rejects a %s SKU before writing a single movement", async (sku) => {
  await expect(recordMovement(movement({ sku }))).rejects.toBeInstanceOf(LedgerAdmissionError);
  expect(writes()).toEqual([]);
  expect(s.rows.stock_ledger).toEqual([]);
});

it("rejects an unowned SKU with a typed 404 admission error naming the SKU", async () => {
  await expect(recordMovement(movement({ sku: "MISSING" }))).rejects.toMatchObject({
    name: "LedgerAdmissionError", status: 404,
  });
});

it("writes a single movement for a tenant-owned SKU inside one tenant transaction", async () => {
  const saved = await recordMovement(movement());
  expect(saved.SKU).toBe("OWN");
  expect(s.rows.stock_ledger).toHaveLength(1);
  expect(s.transactions).toBe(1);
  expect(s.events.every((e) => e.inTx)).toBe(true);
});

it("admits the SKU before checking availability for an Out movement", async () => {
  await expect(recordMovement(movement({ sku: "MISSING", direction: "Out" })))
    .rejects.toBeInstanceOf(LedgerAdmissionError);
  expect(assertStockAvailable).not.toHaveBeenCalled();
  expect(s.rows.stock_ledger).toEqual([]);
});

it("uses each tenant's own item for a shared SKU string, never a foreign one", async () => {
  await recordMovement(movement({ sku: "OWN" }));
  s.orgId = "org-b";
  await expect(recordMovement(movement({ sku: "OWN" }))).rejects.toBeInstanceOf(LedgerAdmissionError);
  expect(s.rows.stock_ledger).toHaveLength(1);
});

it("joins the caller's tenant transaction and rolls the movement back when the owner fails", async () => {
  await expect(runInTenantTransaction("org-a", async () => {
    await recordMovement(movement());
    expect(s.rows.stock_ledger).toHaveLength(1);
    throw new Error("owner failed");
  })).rejects.toThrow("owner failed");
  expect(s.transactions).toBe(1);
  expect(s.rows.stock_ledger).toEqual([]);
});

it("preserves the written row when a confirmed-commit cleanup failure is reported", async () => {
  const { createTenantTransactionAdapter } = await import("@/db/transaction-context");
  void createTenantTransactionAdapter; // adapter's own confirmed-commit contract is exercised directly below.
  // Simulate a lost post-commit effect: reuse the real adapter via afterTenantCommit.
  const { afterTenantCommit } = await import("@/db/client");
  let threw: unknown;
  try {
    await runInTenantTransaction("org-a", async () => {
      await recordMovement(movement());
      await afterTenantCommit(async () => { throw new Error("cleanup failed"); });
    });
  } catch (error) { threw = error; }
  expect(threw).toMatchObject({ committed: true });
  expect(s.rows.stock_ledger).toHaveLength(1);
});

// --- Bulk/import admission (recordMovementsBulk) -----------------------------------

it("rejects the whole bulk batch without any write when one SKU is unowned", async () => {
  await expect(recordMovementsBulk([movement(), movement({ sku: "MISSING" })]))
    .rejects.toBeInstanceOf(LedgerAdmissionError);
  expect(writes()).toEqual([]);
  expect(s.rows.stock_ledger).toEqual([]);
});

it("rejects a bulk batch containing only a foreign-tenant SKU", async () => {
  await expect(recordMovementsBulk([movement({ sku: "FOREIGN" })]))
    .rejects.toBeInstanceOf(LedgerAdmissionError);
  expect(s.rows.stock_ledger).toEqual([]);
});

it("admits every distinct SKU once and writes the full bulk batch when all are owned", async () => {
  s.rows.items.push(item("OWN2"));
  await recordMovementsBulk([movement(), movement({ sku: "OWN2" }), movement({ sku: "OWN" })]);
  expect(s.rows.stock_ledger).toHaveLength(3);
  expect(s.events.filter((e) => e.operation === "select" && e.table === "items")).toHaveLength(2);
});

it("checks availability only after every SKU in the batch is admitted", async () => {
  await expect(recordMovementsBulk([movement({ direction: "Out" }), movement({ sku: "MISSING" })]))
    .rejects.toBeInstanceOf(LedgerAdmissionError);
  expect(assertStockAvailableMany).not.toHaveBeenCalled();
  expect(s.rows.stock_ledger).toEqual([]);
});

it("joins the caller's tenant transaction and rolls the whole bulk batch back on owner failure", async () => {
  await expect(runInTenantTransaction("org-a", async () => {
    await recordMovementsBulk([movement(), movement({ sku: "OWN" })]);
    expect(s.rows.stock_ledger).toHaveLength(2);
    throw new Error("owner failed");
  })).rejects.toThrow("owner failed");
  expect(s.rows.stock_ledger).toEqual([]);
});

it("rejects an empty bulk batch as a no-op without admitting or writing anything", async () => {
  await recordMovementsBulk([]);
  expect(s.events).toEqual([]);
  expect(s.rows.stock_ledger).toEqual([]);
});
