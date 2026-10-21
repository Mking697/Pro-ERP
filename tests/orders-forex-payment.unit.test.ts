import { beforeEach, expect, it, vi } from "vitest";

/**
 * DB-free unit tests for forex gain/loss GL posting on foreign-currency order payments
 * (recordPayment()'s new optional `faceAmountReceived` path in src/lib/orders/orders.ts).
 * Mirrors the mocking harness of tests/orders-unit.test.ts (in-memory tables + tenant
 * transaction adapter), with @/lib/currency/currency mocked directly so
 * getLatestExchangeRate()'s "today's rate" is fully controllable per test — the real
 * point-in-time resolution logic already has its own coverage in currency-unit.test.ts.
 *
 * The single most important assertion in this file: for an ordinary INR payment (no
 * faceAmountReceived), the journal lines and the stored order_payments.amount are BYTE
 * IDENTICAL to before this feature existed — see "ordinary INR payment" below.
 */
type Row = Record<string, unknown>;
type Table = { name: string } & Record<string, string>;
type Predicate = (row: Row) => boolean;
const h = vi.hoisted(() => {
  const names = ["customers", "orderActivities", "orderItems", "orderPayments", "orders", "quotationItems", "quotations"];
  const tables = Object.fromEntries(names.map((name) => [name, Object.assign({ name }, Object.fromEntries(["id", "orgId", "orderId", "lineNo", "sku", "status", "customerId", "quotationId", "createdAt", "receivedAt"].map((key) => [key, key])))]));
  const state = { rows: {} as Record<string, Row[]>, active: false, events: [] as string[], sequence: 0, effects: [] as (() => Promise<void>)[] };
  const transaction = vi.fn(async (_org: string, work: () => Promise<unknown>) => {
    if (state.active) return work();
    const snapshot = structuredClone(state.rows);
    state.active = true;
    let result: unknown;
    try { result = await work(); }
    catch (error) { state.rows = snapshot; state.effects = []; throw error; }
    finally { state.active = false; }
    const effects = state.effects.splice(0);
    for (const effect of effects) await effect();
    return result;
  });
  const select = vi.fn(() => ({ from: (table: Table) => ({ where: async (predicate: Predicate) => {
    state.events.push(`read:${table.name}`);
    return state.rows[table.name].filter(predicate);
  } }) }));
  const update = vi.fn((table: Table) => ({ set: (values: Row) => ({ where: async (predicate: Predicate) => {
    state.events.push(`write:${table.name}`);
    for (const row of state.rows[table.name].filter(predicate)) Object.assign(row, values);
  } }) }));
  const insert = vi.fn(async (table: Table, values: Row) => {
    state.events.push(`write:${table.name}`);
    state.rows[table.name].push({ createdAt: new Date("2026-01-01"), ...values });
  });
  const find = vi.fn(async (table: Table, orgId: string, id: string) => {
    state.events.push(`read:${table.name}`);
    return state.rows[table.name].find((row) => row.orgId === orgId && row.id === id) ?? null;
  });
  const journal = vi.fn(async (input: Row) => { state.events.push("journal"); state.rows.journals.push(input); return "JRN-1"; });
  const rate = vi.fn(async (_code: string) => null as { rateToInr: number } | null);
  return { tables, state, transaction, select, update, insert, find, journal, rate,
    afterCommit: vi.fn(async (effect: () => Promise<void>) => { if (state.active) state.effects.push(effect); else await effect(); }),
  };
});
vi.mock("drizzle-orm", () => ({
  eq: (key: string, value: unknown) => (row: Row) => row[key] === value,
  and: (...predicates: Predicate[]) => (row: Row) => predicates.every((predicate) => predicate(row)),
  inArray: (key: string, values: unknown[]) => (row: Row) => values.includes(row[key]),
  desc: (key: string) => key,
}));
vi.mock("@/db/schema", () => h.tables);
vi.mock("@/db/client", () => ({ db: { select: h.select, update: h.update }, runInTenantTransaction: h.transaction, afterTenantCommit: h.afterCommit }));
vi.mock("@/db/repo", () => ({ findById: h.find, insertRecord: h.insert,
  updateById: async (table: Table, org: string, id: string, values: Row) => h.update(table).set(values).where((row) => row.orgId === org && row.id === id),
  listByOrg: async (table: Table, org: string) => h.state.rows[table.name].filter((row) => row.orgId === org),
}));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "ORG" }));
vi.mock("@/lib/id", () => ({ generateId: (prefix: string) => `${prefix}-${++h.state.sequence}` }));
vi.mock("@/lib/mutations", () => ({ runIdempotentTenantMutation: vi.fn(async (_org: string, _options: Row, work: () => Promise<unknown>) => h.transaction(_org, work)) }));
vi.mock("@/lib/inventory/availability", () => ({ getStockAvailability: vi.fn() }));
vi.mock("@/lib/inventory/items", () => ({ findItem: vi.fn() }));
vi.mock("@/lib/parties/customers", () => ({ createCustomer: vi.fn() }));
vi.mock("@/lib/fms/engine", () => ({ emitFmsEvent: vi.fn(), startFmsInstance: vi.fn() }));
vi.mock("@/lib/fms/templates", () => ({ listFmsTemplates: vi.fn(async () => []) }));
vi.mock("@/lib/tasks", () => ({ createTask: vi.fn() }));
vi.mock("@/lib/chatxflow", () => ({ sendWhatsAppMessage: vi.fn() }));
vi.mock("@/lib/auth/users", () => ({ listUsers: vi.fn(async () => []) }));
vi.mock("@/lib/moduleAccess", () => ({ effectiveModuleAccess: () => [] }));
vi.mock("@/lib/orders/settings", () => ({ getOrderSetup: async () => ({ creditHoldApprover: "actor" }) }));
vi.mock("@/lib/accounts/ledger", () => ({
  postJournalEntry: h.journal,
  SYSTEM_ACCOUNT_CODES: { CASH_BANK: "CASH", ACCOUNTS_RECEIVABLE: "AR", CUSTOMER_CREDIT_BALANCE: "CC", FOREX_GAIN: "FXG", FOREX_LOSS: "FXL" },
}));
vi.mock("@/lib/currency/currency", () => ({
  getLatestExchangeRate: h.rate,
  resolveDisplayCurrency: vi.fn(async () => null),
}));
vi.mock("@/lib/pdi/pdi", () => ({ noteStockAvailable: vi.fn() }));
vi.mock("@/lib/events/emit", () => ({ emitDomainEvent: vi.fn() }));

import { recordPayment, OrderError } from "@/lib/orders/orders";

function sumLines(key: "debit" | "credit", lines: Row[]): number {
  return lines.reduce((sum, l) => sum + (Number(l[key]) || 0), 0);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.active = false; h.state.events = []; h.state.effects = []; h.state.sequence = 0;
  h.state.rows = Object.fromEntries([...Object.keys(h.tables), "journals"].map((name) => [name, []]));
  h.rate.mockResolvedValue(null);
  h.state.rows.orders.push({
    id: "ORD", orgId: "ORG", status: "Stock_Check", source: "Direct", transportArrangedBy: null,
    customerId: "CUS", orderValue: "100", gstPercent: "18", gstAmount: "18",
    createdAt: new Date("2026-01-01"), creditApprovedAt: null, dispatchCommitDate: null,
    displayCurrency: "INR", displayExchangeRate: null, displayAmount: null,
    ...Object.fromEntries(["leadId", "quotationId", "partyName", "contactPerson", "customerMobile", "customerEmail", "customerGst", "billingAddress", "billingCity", "billingState", "billingPincode", "shippingPartyName", "shippingContactPerson", "shippingAddress", "shippingCity", "shippingState", "shippingPincode", "poAttachmentUrl", "creditApprovedBy", "createdBy", "pdiId"].map((key) => [key, ""])),
  });
});

// --- Regression: ordinary INR payment is byte-identical to pre-forex behavior ---------

it("ordinary INR payment (no faceAmountReceived) posts the exact same 2-line journal as before", async () => {
  await recordPayment("ORD", { amount: 10, mode: "Cash" }, "actor");
  expect(h.state.rows.orderPayments[0].amount).toBe("10");
  const posted = h.journal.mock.calls[0][0] as Row;
  expect(posted.lines).toEqual([
    { accountCode: "CASH", debit: 10 },
    { accountCode: "AR", credit: 10 },
  ]);
  expect(h.rate).not.toHaveBeenCalled();
});

it("ordinary INR payment with Credit_Note mode is unchanged", async () => {
  await recordPayment("ORD", { amount: 25, mode: "Credit_Note" }, "actor");
  const posted = h.journal.mock.calls[0][0] as Row;
  expect(posted.lines).toEqual([
    { accountCode: "CC", debit: 25 },
    { accountCode: "AR", credit: 25 },
  ]);
});

// --- Foreign-currency path --------------------------------------------------------------

function makeForeignOrder(displayExchangeRate: number) {
  h.state.rows.orders[0].displayCurrency = "USD";
  h.state.rows.orders[0].displayExchangeRate = String(displayExchangeRate);
  h.state.rows.orders[0].displayAmount = "500";
}

it("foreign payment with no real rate movement posts exactly 2 balanced lines (forexDelta === 0)", async () => {
  makeForeignOrder(83);
  h.rate.mockResolvedValue({ rateToInr: 83 });
  await recordPayment("ORD", { amount: 41500, mode: "Bank_Transfer", faceAmountReceived: 500 }, "actor");
  expect(h.state.rows.orderPayments[0].amount).toBe("41500");
  const posted = h.journal.mock.calls[0][0] as Row;
  const lines = posted.lines as Row[];
  expect(lines).toEqual([
    { accountCode: "CASH", debit: 41500 },
    { accountCode: "AR", credit: 41500 },
  ]);
  expect(sumLines("debit", lines)).toBe(sumLines("credit", lines));
});

it("foreign payment where today's rate is HIGHER posts a 3rd FOREX_GAIN credit line, balanced", async () => {
  makeForeignOrder(83); // order-time rate
  h.rate.mockResolvedValue({ rateToInr: 85 }); // today's rate is higher
  await recordPayment("ORD", { amount: 1, mode: "Bank_Transfer", faceAmountReceived: 500 }, "actor");
  // expectedInr = 500*83 = 41500 (stored amount, AR credit); actualInr = 500*85 = 42500 (cash debit)
  expect(h.state.rows.orderPayments[0].amount).toBe("41500");
  const posted = h.journal.mock.calls[0][0] as Row;
  const lines = posted.lines as Row[];
  expect(lines).toEqual([
    { accountCode: "CASH", debit: 42500 },
    { accountCode: "AR", credit: 41500 },
    { accountCode: "FXG", credit: 1000 },
  ]);
  expect(sumLines("debit", lines)).toBe(sumLines("credit", lines));
  expect(sumLines("debit", lines)).toBe(42500);
});

it("foreign payment where today's rate is LOWER posts a 3rd FOREX_LOSS debit line, balanced", async () => {
  makeForeignOrder(83);
  h.rate.mockResolvedValue({ rateToInr: 80 }); // today's rate is lower
  await recordPayment("ORD", { amount: 1, mode: "Bank_Transfer", faceAmountReceived: 500 }, "actor");
  // expectedInr = 500*83 = 41500; actualInr = 500*80 = 40000
  expect(h.state.rows.orderPayments[0].amount).toBe("41500");
  const posted = h.journal.mock.calls[0][0] as Row;
  const lines = posted.lines as Row[];
  expect(lines).toEqual([
    { accountCode: "CASH", debit: 40000 },
    { accountCode: "AR", credit: 41500 },
    { accountCode: "FXL", debit: 1500 },
  ]);
  expect(sumLines("debit", lines)).toBe(sumLines("credit", lines));
  expect(sumLines("debit", lines)).toBe(41500);
});

it("rejects a foreign payment when no exchange rate is configured today — no partial write", async () => {
  makeForeignOrder(83);
  h.rate.mockResolvedValue(null);
  await expect(
    recordPayment("ORD", { amount: 1, mode: "Bank_Transfer", faceAmountReceived: 500 }, "actor")
  ).rejects.toBeInstanceOf(OrderError);
  expect(h.state.rows.orderPayments).toEqual([]);
  expect(h.state.rows.orderActivities).toEqual([]);
  expect(h.journal).not.toHaveBeenCalled();
});

it("rejects faceAmountReceived against a plain INR order (not eligible for forex posting)", async () => {
  // displayCurrency stays "INR" (the default fixture) — faceAmountReceived has no meaning here.
  await expect(
    recordPayment("ORD", { amount: 1, mode: "Cash", faceAmountReceived: 500 }, "actor")
  ).rejects.toBeInstanceOf(OrderError);
  expect(h.state.rows.orderPayments).toEqual([]);
  expect(h.journal).not.toHaveBeenCalled();
});

it("stores order_payments.amount as expectedInr, never actualInr, in the gain case", async () => {
  makeForeignOrder(80);
  h.rate.mockResolvedValue({ rateToInr: 90 });
  await recordPayment("ORD", { amount: 1, mode: "Bank_Transfer", faceAmountReceived: 10 }, "actor");
  // expectedInr = 10*80 = 800; actualInr = 10*90 = 900 — must store 800, not 900.
  expect(h.state.rows.orderPayments[0].amount).toBe("800");
  expect(h.state.rows.orderPayments[0].amount).not.toBe("900");
});

it("stores order_payments.amount as expectedInr, never actualInr, in the loss case", async () => {
  makeForeignOrder(90);
  h.rate.mockResolvedValue({ rateToInr: 80 });
  await recordPayment("ORD", { amount: 1, mode: "Bank_Transfer", faceAmountReceived: 10 }, "actor");
  // expectedInr = 10*90 = 900; actualInr = 10*80 = 800 — must store 900, not 800.
  expect(h.state.rows.orderPayments[0].amount).toBe("900");
  expect(h.state.rows.orderPayments[0].amount).not.toBe("800");
});
