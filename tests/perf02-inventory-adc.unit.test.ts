/* eslint-disable @typescript-eslint/no-explicit-any -- DB-free query-shape harness. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

// PERF-02: ADC uses one filtered operand read/fold instead of one JS scan of
// the whole ledger array per item, and a single-item detail view must read only that
// SKU's own rows, never the whole org's items/ledger. This file asserts both the query
// SHAPE (call counts) and that the new path's numbers are IDENTICAL to the old
// per-item ledger-scan formula for representative fixtures.

type Row = Record<string, any>;
const state = vi.hoisted(() => ({
  nextResult: [] as Row[],
  rawRows: undefined as Row[] | undefined,
  selectCalls: 0,
  groupByCalls: 0,
  whereCalls: 0,
  predicates: [] as SQL[],
  projections: [] as Record<string, any>[],
  limits: [] as number[],
  offsets: [] as number[],
}));

vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "org-1" }));

vi.mock("@/db/client", () => {
  function builder() {
    const b: any = {
      from: () => b,
      where: (predicate: SQL) => { state.whereCalls++; state.predicates.push(predicate); return b; },
      groupBy: () => { state.groupByCalls++; return b; },
      orderBy: () => b,
      limit: (n: number) => { state.limits.push(n); return b; },
      offset: (n: number) => { state.offsets.push(n); return b; },
      then: (resolve: any) => resolve(state.projections.at(-1)?.quantity && state.rawRows ? state.rawRows : state.nextResult),
    };
    return b;
  }
  return {
    db: { select: (projection: Record<string, any> = {}) => { state.selectCalls++; state.projections.push(projection); return builder(); } },
    runInTenantTransaction: async (_org: string, work: () => unknown) => work(),
  };
});

import {
  adcFromLedger,
  buildItemStock,
  fetchAdcBySku,
  fetchAdcForSku,
  listLedgerForSku,
  type LedgerRecord,
} from "@/lib/inventory/ledger";
import type { ItemRecord } from "@/lib/inventory/items";

beforeEach(() => {
  state.nextResult = [];
  state.rawRows = undefined;
  state.selectCalls = 0;
  state.groupByCalls = 0;
  state.whereCalls = 0;
  state.predicates = []; state.projections = []; state.limits = []; state.offsets = [];
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
});

afterEach(() => vi.useRealTimers());

it.each(["snapshot", "detail"])("%s ADC retains the old JS addition rather than decimal SQL SUM", async mode => {
  // PostgreSQL numeric SUM('0.1', '0.2') is exactly '0.3'. JS's historical fold is not.
  state.nextResult = [{ sku: "A", total: "0.3" }];
  state.rawRows = [{ sku: "A", quantity: "0.1" }, { sku: "A", quantity: "0.2" }];
  const expected = (Number("0.1") + Number("0.2")) / 30;
  const actual = mode === "snapshot" ? (await fetchAdcBySku("org-1")).get("A") : await fetchAdcForSku("A");
  expect(actual).toBe(expected);
});

// --- fetchAdcBySku: one aggregate query, not one per item --------------------------

it("fetchAdcBySku reads minimal operands once, regardless of item count", async () => {
  state.nextResult = [
    { sku: "A", quantity: "90" },
  ];
  const map = await fetchAdcBySku("org-1", 30);
  expect(state.selectCalls).toBe(1);
  expect(state.groupByCalls).toBe(0);
  const query = new PgDialect().sqlToQuery(state.predicates[0]);
  expect(query.sql).toContain('"stock_ledger"."org_id" =');
  expect(query.sql).toContain('"stock_ledger"."direction" =');
  expect(query.sql).toContain('"stock_ledger"."timestamp" >=');
  expect(query.params).toEqual(["org-1", "Out", "2026-09-09T12:00:00.000Z"]);
  expect(Object.keys(state.projections[0])).toEqual(["sku", "quantity"]);
  // No qualifying Out rows for B: missing entry has the same meaning as the
  // reference adcFromLedger's null (never moved out, not zero).
  expect(map.has("B")).toBe(false);
  expect(map.get("A")).toBe(3); // 90 / 30
});

it("fetchAdcBySku's division matches adcFromLedger's own formula for the same qualifying rows", async () => {
  const windowDays = 30;
  const now = Date.now();
  const ledgerRow = (overrides: Partial<LedgerRecord>): LedgerRecord => ({
    Txn_ID: "T", Timestamp: new Date(now).toISOString(), SKU: "A", Direction: "Out",
    Quantity: "0", UOM: "kg", Source: "Manual", Reference_ID: "", Location: "",
    Issued_To: "", Remark: "", User_ID: "", ...overrides,
  });
  const ledger: LedgerRecord[] = [
    ledgerRow({ Timestamp: new Date(now - 1_000).toISOString(), Quantity: "10" }),
    ledgerRow({ Timestamp: new Date(now - 2_000).toISOString(), Quantity: "5" }),
    // Outside the window — must not count on either path.
    ledgerRow({
      Timestamp: new Date(now - windowDays * 86_400_000 - 10_000).toISOString(),
      Quantity: "999",
    }),
    // An `In` movement — must not count on either path.
    ledgerRow({ Direction: "In", Timestamp: new Date(now - 500).toISOString(), Quantity: "50" }),
  ];

  const oldWay = adcFromLedger(ledger, "A", windowDays);
  // The transport supplies the same qualifying operands; SQL predicate shape is
  // checked separately above. This does not claim real PostgreSQL execution proof.
  state.nextResult = [{ sku: "A", quantity: "10" }, { sku: "A", quantity: "5" }];
  const newWay = await fetchAdcBySku("org-1", windowDays);

  expect(oldWay).not.toBeNull();
  expect(newWay.get("A")).toBe(oldWay);
});

it("fetchAdcForSku scopes to one SKU and returns null (not 0) when nothing qualified", async () => {
  state.nextResult = [];
  const adc = await fetchAdcForSku("SOME-SKU", 30);
  expect(state.selectCalls).toBe(1);
  expect(adc).toBeNull();
});

it("fetchAdcForSku's result matches adcFromLedger for the same single-SKU fixture", async () => {
  const windowDays = 7;
  const now = Date.now();
  const ledger: LedgerRecord[] = [
    {
      Txn_ID: "1", Timestamp: new Date(now - 1_000).toISOString(), SKU: "X", Direction: "Out",
      Quantity: "21", UOM: "kg", Source: "Manual", Reference_ID: "", Location: "", Issued_To: "",
      Remark: "", User_ID: "",
    },
  ];
  const oldWay = adcFromLedger(ledger, "X", windowDays);
  state.nextResult = [{ quantity: "21" }];
  const newWay = await fetchAdcForSku("X", windowDays);
  expect(newWay).toBe(oldWay);
});

// --- listLedgerForSku: one SQL-filtered query, not "fetch all, filter in JS" -------

it("listLedgerForSku issues exactly one query (SKU pushed into SQL, not filtered after a full fetch)", async () => {
  state.nextResult = [
    {
      id: "TXN-1", orgId: "org-1", timestamp: new Date("2026-10-01T00:00:00Z"), sku: "A",
      direction: "Out", quantity: "5", uom: "kg", source: "Manual", referenceId: "",
      location: "", issuedTo: "", remark: "", userId: "u1",
    },
  ];
  const rows = await listLedgerForSku("A");
  expect(state.selectCalls).toBe(1);
  expect(state.whereCalls).toBeGreaterThanOrEqual(1);
  expect(rows).toHaveLength(1);
  expect(rows[0].SKU).toBe("A");
});

// --- buildItemStock: pure function, given a precomputed ADC ------------------------

const item = (overrides: Partial<ItemRecord>): ItemRecord => ({
  SKU: "A", Item_Name: "Item A", Category: "Raw Material", Size_Unit: "", UOM: "kg",
  Rate: "", ADC_Manual: "", Lead_Time_Days: "5", Safety_Factor: "1.2", MOQ: "", Max_Level: "100",
  Location: "", Status: "Active", Created_At: "", Created_By: "", ...overrides,
});

it("buildItemStock prefers a manual ADC override over the precomputed ledger value", () => {
  const stock = buildItemStock(
    item({ ADC_Manual: "7" }),
    3, // the precomputed ledger-derived value must be ignored
    new Map([["A", 50]]),
    new Map(),
    new Map(),
    new Map()
  );
  expect(stock.adc).toBe(7);
  expect(stock.adcIsManual).toBe(true);
  expect(stock.rop).toBe(7 * 5 * 1.2);
});

it("buildItemStock falls back to the precomputed ledger ADC when there is no manual override", () => {
  const stock = buildItemStock(item({}), 4.5, new Map([["A", 50]]), new Map(), new Map(), new Map());
  expect(stock.adc).toBe(4.5);
  expect(stock.adcIsManual).toBe(false);
  expect(stock.missingFields).not.toContain("ADC");
});

it("buildItemStock reports ADC as a missing field when neither value is available", () => {
  const stock = buildItemStock(item({}), null, new Map([["A", 50]]), new Map(), new Map(), new Map());
  expect(stock.adc).toBeNull();
  expect(stock.missingFields).toContain("ADC");
  expect(stock.rop).toBeNull();
});

it("movement history supports SQL pagination, always scoped to tenant and SKU", async () => {
  await listLedgerForSku("A", { limit: 20, offset: 40 });
  expect(state.limits).toEqual([20]);
  expect(state.offsets).toEqual([40]);
  expect(new PgDialect().sqlToQuery(state.predicates[0]).params).toEqual(["org-1", "A"]);
});

it("single-SKU ADC includes the SKU predicate as well as tenant/direction/date", async () => {
  state.nextResult = [{ quantity: "0" }];
  expect(await fetchAdcForSku("A", 7)).toBe(0);
  const query = new PgDialect().sqlToQuery(state.predicates[0]);
  expect(query.sql).toContain('"stock_ledger"."sku" =');
  expect(query.params).toEqual(["org-1", "A", "Out", "2026-10-02T12:00:00.000Z"]);
});

it("manual zero overrides ADC and reservation arithmetic remains rounded to three places", () => {
  const stock = buildItemStock(item({ ADC_Manual: "0" }), 12, new Map([["A", 3.3]]), new Map([["A", 1.1]]), new Map([["A", 0.1]]), new Map([["A", 0.1]]));
  expect(stock).toMatchObject({ adc: 0, adcIsManual: true, onHand: 3.3, committed: 1.1, orderReserved: 0.1, free: 2.1, projected: 2.2, rop: 0 });
});
