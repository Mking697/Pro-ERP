import { beforeEach, expect, it, vi } from "vitest";
import { getTableName, getTableColumns, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

// Real routes + Orders + mutation receipts; ONLY persistence/tenant/external effects
// are substituted. The serial admission adapter models the existing tenant DB lock;
// this is not evidence from a live PostgreSQL server.
const h = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  return { scope: new AsyncLocalStorage<boolean>(), rows: {} as Record<string, Record<string, unknown>[]>, queue: Promise.resolve(), journals: [] as unknown[] };
});
function rows(table: unknown) { return h.rows[getTableName(table as typeof schema.orders)] ??= []; }
function filter(table: unknown, where?: SQL) {
  if (!where) return rows(table);
  const query = new PgDialect().sqlToQuery(where);
  const columns = getTableColumns(table as typeof schema.orders);
  return rows(table).filter((row) => Object.entries(columns).every(([key, column]) => {
    const regex = new RegExp(`"${column.name}" = \\$(\\d+)`, "g");
    return [...query.sql.matchAll(regex)].every((match) => row[key] === query.params[Number(match[1]) - 1]);
  }));
}
async function transaction<T>(_org: string, work: () => Promise<T>): Promise<T> {
  if (h.scope.getStore()) return work();
  const previous = h.queue; let release!: () => void;
  h.queue = new Promise<void>((resolve) => { release = resolve; }); await previous;
  const snapshot = structuredClone(h.rows);
  try { return await h.scope.run(true, work); }
  catch (error) { h.rows = snapshot; throw error; }
  finally { release(); }
}
function builder(work: () => unknown) {
  return { then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return Promise.resolve().then(work).then(resolve, reject); } };
}
vi.mock("@/db/client", () => ({
  runInTenantTransaction: transaction, isInTenantTransaction: () => !!h.scope.getStore(), afterTenantCommit: async () => {},
  db: {
    select: () => ({ from: (table: unknown) => {
      let where: SQL | undefined; let max = Infinity;
      const q = Object.assign(builder(() => filter(table, where).slice(0, max)), { where: (value: SQL) => { where = value; return q; }, limit: (value: number) => { max = value; return q; }, orderBy: () => q }); return q;
    } }),
    insert: (table: unknown) => ({ values: (value: Record<string, unknown>) => builder(() => {
      if (table === schema.mutationReceipts) value.result = JSON.parse(new PgDialect().sqlToQuery(value.result as SQL).params[0] as string);
      rows(table).push({ ...value });
    }) }),
    update: (table: unknown) => ({ set: (values: Record<string, unknown>) => ({ where: (where: SQL) => builder(() => { filter(table, where).forEach((row) => Object.assign(row, values)); }) }) }),
  },
}));
vi.mock("@/db/repo", () => ({
  findById: async (table: unknown, orgId: string, id: string) => rows(table).find((row) => row.orgId === orgId && row.id === id) ?? null,
  listByOrg: async (table: unknown, orgId: string) => rows(table).filter((row) => row.orgId === orgId),
  insertRecord: async (table: unknown, value: Record<string, unknown>) => { const row = { createdAt: new Date(), ...value }; rows(table).push(row); return row; },
  updateById: async (table: unknown, orgId: string, id: string, value: Record<string, unknown>) => { const row = rows(table).find((row) => row.id === id && row.orgId === orgId); Object.assign(row!, value); return row; },
}));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "ORG" }));
vi.mock("@/lib/auth/guard", () => ({ requireModule: async () => ({ ok: true, session: { userId: "ACTOR", role: "Admin" }, tenant: { orgId: "ORG" } }) }));
vi.mock("@/lib/inventory/availability", () => ({ getStockAvailability: async () => ({ onHand: new Map([["SKU", 10]]), orderReserved: new Map(), planReserved: new Map(), free: new Map([["SKU", 10]]) }) }));
vi.mock("@/lib/inventory/items", () => ({ findItem: vi.fn() }));
vi.mock("@/lib/parties/customers", () => ({ createCustomer: vi.fn() }));
vi.mock("@/lib/fms/engine", () => ({ emitFmsEvent: vi.fn(), startFmsInstance: vi.fn() }));
vi.mock("@/lib/fms/templates", () => ({ listFmsTemplates: async () => [] }));
vi.mock("@/lib/tasks", () => ({ createTask: vi.fn() }));
vi.mock("@/lib/chatxflow", () => ({ sendWhatsAppMessage: vi.fn() }));
vi.mock("@/lib/auth/users", () => ({ listUsers: async () => [] }));
vi.mock("@/lib/moduleAccess", () => ({ effectiveModuleAccess: () => [] }));
vi.mock("@/lib/orders/settings", () => ({ getOrderSetup: async () => ({ creditHoldApprover: "ACTOR" }) }));
vi.mock("@/lib/accounts/ledger", () => ({ postJournalEntry: async (value: unknown) => { h.journals.push(value); }, SYSTEM_ACCOUNT_CODES: { CASH_BANK: "CASH", ACCOUNTS_RECEIVABLE: "AR" } }));
vi.mock("@/lib/pdi/pdi", () => ({ noteStockAvailable: vi.fn() }));
vi.mock("@/lib/events/emit", () => ({ emitDomainEvent: vi.fn() }));
import { POST as payment } from "@/app/api/orders/[orderId]/payment/route";
import { POST as review } from "@/app/api/orders/[orderId]/payment-review/route";
import { POST as credit } from "@/app/api/orders/[orderId]/credit-approve/route";
import { POST as stock } from "@/app/api/orders/[orderId]/stock-check/route";
import { POST as dispatch } from "@/app/api/orders/[orderId]/dispatch-commit/route";
import { POST as cancel } from "@/app/api/orders/[orderId]/cancel/route";

beforeEach(() => {
  h.rows = {}; h.queue = Promise.resolve(); h.journals = [];
  rows(schema.orders).push({ id: "ORD", orgId: "ORG", status: "Payment_Review", source: "Direct", transportArrangedBy: "Party", customerId: "CUS", orderValue: "100", gstPercent: "18", gstAmount: "18", createdAt: new Date(), creditApprovedAt: null, dispatchCommitDate: null, displayCurrency: "INR", displayAmount: null, displayExchangeRate: null,
    ...Object.fromEntries(["leadId", "quotationId", "partyName", "contactPerson", "customerMobile", "customerEmail", "customerGst", "billingAddress", "billingCity", "billingState", "billingPincode", "shippingPartyName", "shippingContactPerson", "shippingAddress", "shippingCity", "shippingState", "shippingPincode", "poAttachmentUrl", "creditApprovedBy", "createdBy", "pdiId"].map((key) => [key, ""])) });
  rows(schema.customers).push({ id: "CUS", orgId: "ORG", creditLimit: "1000", creditDays: null });
  rows(schema.orderItems).push({ orgId: "ORG", orderId: "ORD", lineNo: "1", sku: "SKU", itemName: "Widget", uom: "PCS", qty: "2", rate: "10", amount: "20", reservedQty: "0", shortageQty: "2", consumedQty: "0" });
});
const context = { params: Promise.resolve({ orderId: "ORD" }) };
function request(body: unknown, key?: string) { return new Request("https://test.invalid/api/orders/ORD/action", { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body) }); }
it("proves the unkeyed payment route duplicates one real-world payment on rapid submission", async () => {
  const body = { amount: 25, mode: "Cash" };
  const responses = await Promise.all([payment(request(body), context), payment(request(body), context)]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(rows(schema.orderPayments)).toHaveLength(2);
  expect(h.journals).toHaveLength(2);
});
it("the keyed payment route already replays concurrent identical requests without duplicate payment/GL rows", async () => {
  const body = { amount: 25, mode: "Cash" };
  const responses = await Promise.all([payment(request(body, "one-payment"), context), payment(request(body, "one-payment"), context)]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(await responses[0].json()).toEqual(await responses[1].json());
  expect(rows(schema.orderPayments)).toHaveLength(1);
  expect(rows(schema.mutationReceipts)).toHaveLength(1);
  expect(h.journals).toHaveLength(1);
});
it("reusing a payment key for a changed payload conflicts instead of recording another payment", async () => {
  expect((await payment(request({ amount: 25, mode: "Cash" }, "one-payment"), context)).status).toBe(200);
  expect((await payment(request({ amount: 30, mode: "Cash" }, "one-payment"), context)).status).toBe(409);
  expect(rows(schema.orderPayments)).toHaveLength(1);
  expect(h.journals).toHaveLength(1);
});
it.each([
  ["review", review, "Payment_Review", {}], ["credit", credit, "Credit_Hold", {}], ["stock", stock, "Stock_Check", {}],
  ["dispatch", dispatch, "Dispatch_Pending", { dispatchCommitDate: "2026-11-01T00:00:00Z" }], ["cancel", cancel, "Payment_Review", { reason: "duplicate-safe" }],
] as const)("bulk %s route replays two rapid keyed actions, one receipt and one status activity", async (_name, route, status, body) => {
  rows(schema.orders)[0].status = status;
  const responses = await Promise.all([route(request(body, "bulk-row"), context), route(request(body, "bulk-row"), context)]);
  expect(responses.map((r) => r.status)).toEqual([200, 200]);
  expect(await responses[0].json()).toEqual(await responses[1].json());
  expect(rows(schema.mutationReceipts)).toHaveLength(1);
  expect(rows(schema.orderActivities)).toHaveLength(1);
});
