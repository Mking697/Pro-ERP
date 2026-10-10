/* eslint-disable @typescript-eslint/no-explicit-any -- Explicit DB-free query-builder boundary. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type Row = Record<string, any>;
type Expression = { op: string; args: any[] };
type Query = { table: string; projection?: Row; predicate?: Expression; group?: any; limit?: number; offset?: number; order?: Expression[] };
const state = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>, queries: [] as Query[], repoReads: [] as string[],
  maps: { committed: new Map<string, number>(), transit: new Map<string, number>(), reserved: new Map<string, number>() },
  getOrder: vi.fn(), payments: vi.fn(),
  tables: Object.fromEntries(["stockLedger", "items", "invoices", "orders", "orderPayments", "chartOfAccounts", "journalLines", "journalEntries", "customers", "bills", "vendors", "pdiInspections", "tmsShipments"].map(name => [name, new Proxy({ name }, { get: (target, key) => key === "name" ? target.name : { table: name, field: key } })])),
}));
// These are construction/transport mocks, NOT domain mocks or a substitute for a real
// PostgreSQL proof. Capture the actual builder operands and projection of real services.
vi.mock("@/db/schema", () => state.tables);
vi.mock("drizzle-orm", () => ({
  eq: (...args: any[]) => ({ op: "eq", args }),
  gte: (...args: any[]) => ({ op: "gte", args }),
  lte: (...args: any[]) => ({ op: "lte", args }),
  and: (...args: any[]) => ({ op: "and", args }),
  inArray: (...args: any[]) => ({ op: "in", args }),
  desc: (column: any) => ({ op: "desc", args: [column] }),
  sql: (strings: TemplateStringsArray, ...args: any[]) => ({ op: "sql", strings: [...strings], args }),
}));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "ORG" }));
vi.mock("@/lib/inventory/availability", () => ({ assertStockAvailable: vi.fn(), assertStockAvailableMany: vi.fn() }));
vi.mock("@/lib/inventory/plans", () => ({ committedBySku: async () => state.maps.committed }));
vi.mock("@/lib/inventory/indents", () => ({ inTransitBySku: async () => state.maps.transit, suggestIndentQty: vi.fn() }));
vi.mock("@/lib/orders/orders", () => ({ orderReservedBySku: async () => state.maps.reserved, getOrder: state.getOrder, listOrderPayments: state.payments }));
function matches(e: Expression | undefined, row: Row): boolean {
  if (!e) return true;
  if (e.op === "and") return e.args.every(arg => matches(arg, row));
  const [column, value] = e.args;
  const actual = row[column.field];
  if (e.op === "eq") return actual === value;
  if (e.op === "in") return value.includes(actual);
  if (e.op === "gte") return actual >= value;
  if (e.op === "lte") return actual <= value;
  throw new Error(`Unsupported mock predicate ${e.op}`);
}
function results(q: Query): Row[] {
  const source = (state.rows[q.table] ?? []).filter(row => matches(q.predicate, row));
  for (const order of [...(q.order ?? [])].reverse()) {
    const field = order.args[0].field;
    source.sort((a, b) => a[field] < b[field] ? 1 : a[field] > b[field] ? -1 : 0);
  }
  const projection = q.projection;
  if (projection?.total?.op === "sql") {
    const column = projection.total.args[0].field;
    if (!q.group) return [{ total: source.length ? String(source.reduce((sum, r) => sum + Number(r[column]), 0)) : null }];
    const totals = new Map<string, number>();
    for (const r of source) totals.set(r[q.group.field], (totals.get(r[q.group.field]) ?? 0) + Number(r[column]));
    return [...totals].map(([key, total]) => ({ [Object.keys(projection)[0]]: key, total: String(total) }));
  }
  return source.slice(q.offset ?? 0, q.limit === undefined ? undefined : (q.offset ?? 0) + q.limit)
    .map(r => q.projection ? Object.fromEntries(Object.entries(q.projection).map(([key, col]) => [key, r[col.field]])) : r);
}
vi.mock("@/db/client", () => ({
  runInTenantTransaction: async (_org: string, work: () => unknown) => work(),
  db: { select: (projection?: Row) => {
    const q: Query = { table: "", projection };
    const b: any = {
      from: (table: { name: string }) => { q.table = table.name; return b; },
      where: (predicate: Expression) => { q.predicate = predicate; return b; },
      groupBy: (column: any) => { q.group = column; return b; },
      innerJoin: () => b, orderBy: (...order: Expression[]) => { q.order = order; return b; },
      limit: (limit: number) => { q.limit = limit; return b; },
      offset: (offset: number) => { q.offset = offset; return b; },
      then: (resolve: any, reject: any) => Promise.resolve().then(() => { state.queries.push(q); return results(q); }).then(resolve, reject),
    }; return b;
  } },
}));
vi.mock("@/db/repo", () => ({
  listByOrg: async (table: { name: string }, org: string) => { state.repoReads.push(table.name); return (state.rows[table.name] ?? []).filter(row => row.orgId === org); },
  findById: vi.fn(), insertRecord: vi.fn(), updateById: vi.fn(),
}));
import { getInventorySnapshot, getItemDetail } from "@/lib/inventory/service";
import { adcFromLedger, listLedgerForSku, onHandBySku, positionFor, type LedgerRecord } from "@/lib/inventory/ledger";
import { getReceivablesAging, getCreditRiskReport } from "@/lib/accounts/accounts";
import { getBalanceSheet, getProfitAndLoss, SYSTEM_ACCOUNT_CODES } from "@/lib/accounts/ledger";
import { round2 } from "@/lib/leads/quotationMath";
import { endOfIstDay } from "@/lib/timestamp";
import * as baselineInventory from "perf02-baseline/inventory-service";
import * as baselineAccounts from "perf02-baseline/accounts";
import * as baselineLedger from "perf02-baseline/account-ledger";
import { performance } from "node:perf_hooks";
function seed(table: string, row: Row) { (state.rows[table] ??= []).push({ orgId: "ORG", createdAt: new Date(), ...row }); }
function movement(sku: string, quantity: string, direction = "Out", days = 1, orgId = "ORG") {
  seed("stockLedger", { id: `${sku}-${quantity}`, sku, quantity, direction, timestamp: new Date(Date.now() - days * 86_400_000), orgId });
}
function referenceLedger(): LedgerRecord[] { return (state.rows.stockLedger ?? []).filter(r => r.orgId === "ORG").map(r => ({ Txn_ID: r.id, SKU: r.sku, Quantity: r.quantity, Direction: r.direction, Timestamp: r.timestamp.toISOString(), UOM: "", Source: "", Reference_ID: "", Location: "", Issued_To: "", Remark: "", User_ID: "" })); }
beforeEach(() => {
  state.rows = {}; state.queries = []; state.repoReads = []; state.getOrder.mockReset(); state.payments.mockReset();
  state.getOrder.mockImplementation(async (id: string) => (state.rows.orders ?? []).find(r => r.orgId === "ORG" && r.id === id) ?? null);
  state.payments.mockImplementation(async (id: string) => (state.rows.orderPayments ?? []).filter(r => r.orgId === "ORG" && r.orderId === id).sort((a, b) => Number(b.receivedAt) - Number(a.receivedAt)).map(r => ({ ...r, amount: Number(r.amount) || 0 })));
  state.maps = { committed: new Map([["A", 1.1]]), transit: new Map([["A", 0.1]]), reserved: new Map([["A", 0.1]]) };
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
  for (const [name, code] of Object.entries(SYSTEM_ACCOUNT_CODES)) seed("chartOfAccounts", { id: name, code, name, type: name.endsWith("EXPENSE") ? "Expense" : name === "SALES_REVENUE" ? "Income" : "Asset" });
});
afterEach(() => vi.useRealTimers());
it.each([1, 100])("snapshot ADC uses one filtered operand read for %s items and equals the old formula", async count => {
  for (let i = 0; i < count; i++) { const sku = i ? `SKU-${i}` : "A"; seed("items", { sku, itemName: sku, adcManual: null, leadTimeDays: "2", safetyFactor: "1.2" }); movement(sku, "3.3", "In"); movement(sku, "1.1"); movement(sku, "999", "Out", 31); }
  movement("A", "2.2", "Out", 30); // inclusive boundary
  movement("A", "999", "Out", 0, "OTHER");
  const result = await getInventorySnapshot();
  const aggregates = state.queries.filter(q => q.table === "stockLedger" && q.projection?.quantity);
  expect(aggregates).toHaveLength(1);
  expect(Object.keys(aggregates[0].projection!)).toEqual(["sku", "quantity"]);
  expect(aggregates[0].group).toBeUndefined();
  expect(aggregates[0].predicate?.args.map(a => [a.op, a.args[0].field, a.args[1]])).toEqual([["eq", "orgId", "ORG"], ["eq", "direction", "Out"], ["gte", "timestamp", new Date("2026-09-09T12:00:00Z")]]);
  for (const stock of result.items) {
    expect(stock.adc).toBe(adcFromLedger(referenceLedger(), stock.sku));
    expect(stock).toMatchObject(positionFor(stock.sku, onHandBySku(referenceLedger()), state.maps.committed, state.maps.transit, state.maps.reserved));
  }
});
it("detail avoids full snapshot and preserves stock independently of movement pagination", async () => {
  seed("items", { sku: "A", itemName: "A", adcManual: "0", leadTimeDays: "2", safetyFactor: "1" });
  for (let i = 0; i < 120; i++) movement("A", "1", "In");
  movement("B", "999", "In"); movement("A", "999", "In", 1, "OTHER");
  const detail = await getItemDetail("A", 30, { limit: 20, offset: 40 });
  expect(detail?.movements).toHaveLength(20);
  expect(detail?.stock).toMatchObject({ onHand: 120, adc: 0, adcIsManual: true, free: 118.8, projected: 118.9 });
  expect(state.repoReads).not.toContain("stockLedger"); expect(state.repoReads).not.toContain("items");
  for (const q of state.queries.filter(q => q.table === "stockLedger")) expect(q.predicate?.args).toEqual(expect.arrayContaining([{ op: "eq", args: [{ table: "stockLedger", field: "sku" }, "A"] }, { op: "eq", args: [{ table: "stockLedger", field: "orgId" }, "ORG"] }]));
});
it("movement pages have stable newest/id ordering without changing the complete on-hand fold", async () => {
  seed("items", { sku: "A", itemName: "A" });
  for (const [id, quantity, timestamp] of [["T-1", "0.0006", "2026-10-08"], ["T-2", "0.0006", "2026-10-09"], ["T-3", "0.0006", "2026-10-09"]]) seed("stockLedger", { id, quantity, timestamp: new Date(timestamp), sku: "A", direction: "In" });
  movement("B", "999", "In");
  const first = await getItemDetail("A", 30, { limit: 1 });
  const second = await getItemDetail("A", 30, { limit: 1, offset: 1 });
  expect(first?.movements.map(r => r.Txn_ID)).toEqual(["T-3"]);
  expect(second?.movements.map(r => r.Txn_ID)).toEqual(["T-2"]);
  expect(first?.stock.onHand).toBe(onHandBySku(referenceLedger()).get("A"));
  expect(second?.stock).toEqual(first?.stock);
});
it("unknown detail returns null without reading movements or reservations", async () => { expect(await getItemDetail("MISSING")).toBeNull(); expect(state.queries.map(q => q.table)).toEqual(["items"]); });
it("history pushes pagination into its SKU-scoped query", async () => {
  await listLedgerForSku("A", { limit: 20, offset: 40 });
  expect(state.queries[0]).toMatchObject({ table: "stockLedger", limit: 20, offset: 40 });
});
it.each([{ limit: 0 }, { limit: 501 }, { limit: 1, offset: -1 }, { limit: 1.5 }])("history rejects invalid pagination %j before querying", async page => {
  await expect(listLedgerForSku("A", page)).rejects.toThrow("Movement page"); expect(state.queries).toEqual([]);
});
it("history defaults to a bounded first page", async () => { await listLedgerForSku("A"); expect(state.queries[0]).toMatchObject({ limit: 100, offset: 0 }); });
function invoice(orderId: string, value: string, days: number, extra: Row = {}) { seed("invoices", { orderId, finalValue: value, status: "Issued", issuedAt: new Date(Date.now() - days * 86_400_000), ...extra }); }
it.each([1, 100])("aging batches minimal order/payment reads for %s orders instead of sequential domain calls", async count => {
  for (let i = 0; i < count; i++) { const id = `O-${i}`; invoice(id, "100", 31); seed("orders", { id, partyName: id, customerId: "C" }); seed("orderPayments", { orderId: id, amount: "20" }); }
  expect((await getReceivablesAging()).grandTotal).toBe(count * 80);
  expect(state.queries).toHaveLength(3); expect(state.getOrder).not.toHaveBeenCalled(); expect(state.payments).not.toHaveBeenCalled();
  expect(Object.keys(state.queries.find(q => q.table === "orders")!.projection!)).toEqual(["id", "customerId", "partyName"]);
  for (const q of state.queries) expect(q.predicate?.args).toEqual(expect.arrayContaining([{ op: "eq", args: [{ table: q.table, field: "orgId" }, "ORG"] }]));
  state.queries = [];
  expect((await baselineAccounts.getReceivablesAging()).grandTotal).toBe(count * 80);
  expect(state.payments).toHaveBeenCalledTimes(count);
  expect(state.getOrder).toHaveBeenCalledTimes(count);
  expect(state.queries).toHaveLength(1); // plus 2N domain calls at the mocked Orders boundary.
});
it("aging retains split-invoice rounding, all bucket boundaries, missing orders, paid orders and tenant isolation", async () => {
  for (const days of [0, 30, 31, 60, 61, 90, 91]) { const id = `D-${days}`; invoice(id, "33.33", days); invoice(id, "66.67", days - 1); seed("orders", { id, partyName: id, customerId: "C" }); seed("orderPayments", { orderId: id, amount: "3.3" }); seed("orderPayments", { orderId: id, amount: "1.1" }); seed("orderPayments", { orderId: id, amount: "999", orgId: "OTHER" }); }
  invoice("D-0", "999", 99, { status: "Draft" }); invoice("D-0", "999", 99, { orgId: "OTHER" });
  invoice("missing", "999", 99); invoice("paid", "50", 99); seed("orders", { id: "paid" }); seed("orderPayments", { orderId: "paid", amount: "50" });
  const aging = await getReceivablesAging();
  const oldOutstanding = round2(round2(33.33 + 66.67) - round2(3.3 + 1.1));
  expect(aging.rows.map(r => [r.daysOutstanding, r.bucket, r.outstanding])).toEqual([[91, "90+", oldOutstanding], [90, "61-90", oldOutstanding], [61, "61-90", oldOutstanding], [60, "31-60", oldOutstanding], [31, "31-60", oldOutstanding], [30, "0-30", oldOutstanding], [0, "0-30", oldOutstanding]]);
  expect(aging.bucketTotals).toEqual({ "0-30": 191.2, "31-60": 191.2, "61-90": 191.2, "90+": 95.6 }); expect(aging.grandTotal).toBe(669.2);
});
it("aging batches raw payment operands so historical sub-paisa sums keep JS rounding", async () => {
  seed("orders", { id: "O", partyName: "O" }); invoice("O", "1", 31);
  seed("orderPayments", { orderId: "O", amount: "0.004" }); seed("orderPayments", { orderId: "O", amount: "0.051" });
  expect((await getReceivablesAging()).grandTotal).toBe(round2(1 - round2(0.004 + 0.051)));
  expect(Object.keys(state.queries.find(q => q.table === "orderPayments")!.projection!)).toEqual(["orderId", "amount"]);
  expect(state.queries.find(q => q.table === "orderPayments")!.order).toEqual([{ op: "desc", args: [{ table: "orderPayments", field: "receivedAt" }] }]);
});
it("empty aging avoids empty IN queries", async () => { expect((await getReceivablesAging()).grandTotal).toBe(0); expect(state.queries).toHaveLength(1); });
it("credit risk inherits batched aging and preserves overdue and limit totals", async () => {
  seed("customers", { id: "C", customerName: "Customer", creditLimit: "50", creditDays: 30 }); seed("orders", { id: "O", customerId: "C", partyName: "Customer" }); invoice("O", "100", 91); seed("orderPayments", { orderId: "O", amount: "20" });
  expect(await getCreditRiskReport()).toMatchObject({ atRiskCount: 1, totalOutstanding: 80, rows: [{ outstanding: 80, over90: 80, overLimit: true, hasOverdue90: true }] }); expect(state.queries).toHaveLength(3);
});
it("balance sheet reads journal lines once, reuses retained earnings and keeps the IST upper boundary", async () => {
  seed("journalLines", { accountId: "CASH_BANK", debit: "100.33", credit: "0", entryDate: endOfIstDay("2026-10-09") });
  seed("journalLines", { accountId: "SALES_REVENUE", debit: "0", credit: "150.55", entryDate: endOfIstDay("2026-10-09") });
  seed("journalLines", { accountId: "RENT_EXPENSE", debit: "50.22", credit: "0", entryDate: endOfIstDay("2026-10-09") });
  const sheet = await getBalanceSheet("2026-10-09");
  expect(sheet.totalAssets).toBe(100.33); expect(sheet.totalEquity).toBe(100.33);
  expect(sheet.equity).toEqual([{ code: "3900", name: "Retained Earnings (Current)", amount: 100.33 }]);
  const reads = state.queries.filter(q => q.table === "journalLines"); expect(reads).toHaveLength(1);
  expect(reads[0].predicate?.args[1]).toEqual({ op: "lte", args: [{ table: "journalEntries", field: "entryDate" }, new Date("2026-10-09T18:29:59.999Z")] });
  state.queries = []; expect((await getProfitAndLoss({ to: "2026-10-09" })).netProfit).toBe(100.33); expect(state.queries.filter(q => q.table === "journalLines")).toHaveLength(1);
});

it.each([[10, 100], [200, 100], [10, 5000]])("read-only source-overlay differential: %s items / %s movements", async (items, history) => {
  for (let i = 0; i < items; i++) seed("items", { sku: i ? `S-${i}` : "A", itemName: `Item ${i}`, adcManual: i === 1 ? "0" : null, leadTimeDays: "2", safetyFactor: "1.2", maxLevel: "50" });
  for (let i = 0; i < history; i++) {
    const sku = i % items ? `S-${i % items}` : "A";
    seed("stockLedger", { id: `T-${i}`, sku, direction: i % 3 ? "Out" : "In", quantity: ["0.1", "0.2", "3.3004", "1.1005"][i % 4], timestamp: new Date(Date.now() - (i % 32) * 86_400_000) });
  }
  const startOld = performance.now(), cpuOld = process.cpuUsage();
  const old = await baselineInventory.getInventorySnapshot();
  const oldMetrics = { elapsedMs: performance.now() - startOld, cpu: process.cpuUsage(cpuOld), queries: state.queries.length + state.repoReads.length };
  state.queries = []; state.repoReads = [];
  const startNew = performance.now(), cpuNew = process.cpuUsage();
  const current = await getInventorySnapshot();
  const newMetrics = { elapsedMs: performance.now() - startNew, cpu: process.cpuUsage(cpuNew), queries: state.queries.length + state.repoReads.length };
  expect(current).toEqual(old);
  expect(newMetrics.queries).toBe(3); // listItems + listLedger + ADC, reservation maps mocked.
  const oldDetail = await baselineInventory.getItemDetail("A");
  state.queries = []; state.repoReads = [];
  const detail = await getItemDetail("A", 30, { limit: 20, offset: 0 });
  expect(detail?.stock).toEqual(oldDetail?.stock);
  expect(detail?.movements).toHaveLength(Math.min(20, oldDetail!.movements.length));
  expect(state.queries).toHaveLength(4); // item + movements + ADC + on-hand, independent of item/history count.
  expect(state.repoReads).toEqual([]);
  console.info("PERF02 DB-free transport/CPU observation", JSON.stringify({ items, history, old: oldMetrics, current: newMetrics }));
});

it("read-only source-overlay aging/credit risk preserves every bucket and sub-paisa split-invoice math", async () => {
  seed("customers", { id: "C", customerName: "Customer", creditLimit: "1", creditDays: 30 });
  for (const days of [0, 30, 31, 60, 61, 90, 91]) {
    const id = `D-${days}`;
    seed("orders", { id, customerId: "C", partyName: id });
    invoice(id, "0.334", days); invoice(id, "0.666", days - 1);
    seed("orderPayments", { orderId: id, amount: "0.004", receivedAt: new Date("2026-10-01") });
    seed("orderPayments", { orderId: id, amount: "0.051", receivedAt: new Date("2026-10-02") });
    seed("orderPayments", { orderId: id, amount: "999", orgId: "OTHER" });
  }
  invoice("missing", "10", 91); invoice("null-date", "10", 0, { issuedAt: null }); seed("orders", { id: "null-date", partyName: "Null date" });
  invoice("paid", "1", 31); seed("orders", { id: "paid" }); seed("orderPayments", { orderId: "paid", amount: "1" });
  invoice("D-0", "999", 91, { status: "Draft" }); invoice("D-0", "999", 91, { orgId: "OTHER" });
  expect(await getReceivablesAging()).toEqual(await baselineAccounts.getReceivablesAging());
  expect(await getCreditRiskReport()).toEqual(await baselineAccounts.getCreditRiskReport());
});

it("read-only source-overlay financial reports preserve retained earnings and both inclusive IST edges", async () => {
  seed("chartOfAccounts", { id: "E", code: "3000", name: "Equity", type: "Equity" });
  seed("chartOfAccounts", { id: "L", code: "2000", name: "Liability", type: "Liability" });
  const lower = new Date("2026-10-08T18:30:00.000Z"), upper = endOfIstDay("2026-10-09");
  for (const [date, value] of [[new Date(lower.getTime() - 1), "999"], [lower, "0.004"], [upper, "0.051"], [new Date(upper.getTime() + 1), "999"]] as const) {
    for (const [accountId, debit, credit] of [["CASH_BANK", value, "0"], ["SALES_REVENUE", "0", value], ["E", "0", "2.22"], ["L", "0", "3.33"], ["RENT_EXPENSE", "0.013", "0"]]) seed("journalLines", { accountId, debit, credit, entryDate: date });
  }
  seed("journalLines", { accountId: "CASH_BANK", debit: "999", credit: "0", entryDate: lower, orgId: "OTHER" });
  expect(await getProfitAndLoss({ from: "2026-10-09", to: "2026-10-09" })).toEqual(await baselineLedger.getProfitAndLoss({ from: "2026-10-09", to: "2026-10-09" }));
  state.queries = []; const current = await getBalanceSheet("2026-10-09");
  expect(state.queries.filter(q => q.table === "journalLines")).toHaveLength(1);
  state.queries = []; expect(current).toEqual(await baselineLedger.getBalanceSheet("2026-10-09"));
  expect(state.queries.filter(q => q.table === "journalLines")).toHaveLength(2);
});
