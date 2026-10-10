import { beforeEach, expect, it, vi } from "vitest";
import { getTableName, getTableColumns, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

// No partial persistence mocks: importing the real client/setup is forbidden here.
const state = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  return { scope: new AsyncLocalStorage<boolean>(), rows: {} as Record<string, Record<string, unknown>[]>, queue: Promise.resolve(), fail: "", writes: [] as boolean[], reads: [] as boolean[], effects: [] as (() => Promise<void>)[] };
});
function rows(table: unknown) { return state.rows[getTableName(table as typeof schema.bills)] ??= []; }
function filter(table: unknown, where?: SQL) {
  if (!where) return rows(table);
  const query = new PgDialect().sqlToQuery(where);
  const columns = getTableColumns(table as typeof schema.bills);
  return rows(table).filter(row => Object.entries(columns).every(([key, column]) => {
    const regex = new RegExp(`"${column.name}" = \\$(\\d+)`, "g");
    return [...query.sql.matchAll(regex)].every(match => row[key] === query.params[Number(match[1]) - 1]);
  }));
}
function read() { state.reads.push(!!state.scope.getStore()); }
async function transaction<T>(_org: string, work: () => Promise<T>): Promise<T> {
  if (state.scope.getStore()) return work();
  const previous = state.queue;
  let release!: () => void;
  state.queue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  const snapshot = structuredClone(state.rows);
  state.effects = [];
  try {
    const result = await state.scope.run(true, work);
    for (const effect of state.effects) await effect();
    return result;
  } catch (error) { state.rows = snapshot; throw error; }
  finally { release(); }
}
function builder(work: () => unknown) {
  return { execute: async () => work(), then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) { return Promise.resolve().then(work).then(resolve, reject); } };
}
vi.mock("@/db/client", () => ({
  runInTenantTransaction: transaction,
  isInTenantTransaction: () => !!state.scope.getStore(),
  afterTenantCommit: async (effect: () => Promise<void>) => { if (state.scope.getStore()) state.effects.push(effect); else await effect(); },
  db: {
    select: (projection?: Record<string, { name: string }>) => ({ from: (table: unknown) => {
      let where: SQL | undefined;
      let max = Infinity;
      const query = Object.assign(builder(() => {
        read();
        return filter(table, where).slice(0, max).map(row => projection ? Object.fromEntries(Object.entries(projection).map(([key, col]) => [key, row[Object.entries(getTableColumns(table as typeof schema.bills)).find(([, c]) => c.name === col.name)![0]]])) : row);
      }), { where: (condition: SQL) => { where = condition; return query; }, limit: (n: number) => { max = n; return query; }, orderBy: () => query });
      return query;
    } }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown> | Record<string, unknown>[]) => builder(() => {
        if (state.fail === getTableName(table as typeof schema.bills)) throw new Error("injected GL fault");
        const result = (Array.isArray(values) ? values : [values]).map(value => ({ createdAt: new Date(), ...value }));
        if (table === schema.mutationReceipts) for (const row of result) {
          const receipt = row as Record<string, unknown>;
          receipt.result = JSON.parse(new PgDialect().sqlToQuery(receipt.result as SQL).params[0] as string);
        }
        rows(table).push(...result); return result;
      }),
      select: (sql: SQL) => ({ returning: () => builder(() => {
        const p = new PgDialect().sqlToQuery(sql).params;
        const debit = table === schema.debitNoteUsages;
        const note = rows(debit ? schema.debitNotes : schema.creditNotes).find(row => row.id === p[2]);
        const noteKey = debit ? "debitNoteId" : "creditNoteId";
        const used = rows(table).filter(row => row[noteKey] === p[2]).reduce((sum, row) => sum + Number(row.amount), 0);
        if (!note || Number(note.amount) - used < Number(p[5])) return [];
        const row = { id: p[0], orgId: p[1], [noteKey]: p[2], kind: p[3], [debit ? "billId" : "orderId"]: p[4], amount: p[5], createdBy: p[6], createdAt: new Date() };
        rows(table).push(row); return [row];
      }) }),
    }),
    batch: async (queries: { execute: () => Promise<unknown> }[]) => { const result = []; for (const query of queries) result.push(await query.execute()); return result; },
  },
}));
vi.mock("@/db/repo", () => ({
  findById: async (table: unknown, org: string, id: string) => { read(); return rows(table).find(row => row.orgId === org && row.id === id) ?? null; },
  listByOrg: async (table: unknown, org: string) => { read(); return rows(table).filter(row => row.orgId === org); },
  insertRecord: async (table: unknown, value: Record<string, unknown>) => { state.writes.push(!!state.scope.getStore()); const row = { createdAt: new Date(), ...value }; rows(table).push(row); return row; },
  updateById: async (table: unknown, org: string, id: string, patch: Record<string, unknown>) => { const row = rows(table).find(row => row.orgId === org && row.id === id); if (row) Object.assign(row, patch); return row; },
}));
vi.mock("@/lib/auth/guard", () => ({ requireModule: async () => ({ ok: true, session: { userId: "ACTOR" }, tenant: { orgId: "ORG-test" } }) }));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "ORG-test" }));
vi.mock("@/lib/orders/orders", () => ({
  getOrder: async (id: string) => { read(); return rows(schema.orders).find(row => row.id === id); },
  listOrderPayments: async () => rows(schema.orderPayments),
  // The integration boundary is mocked; real-driver suite exercises Orders itself.
  recordPayment: vi.fn(async (orderId: string, input: { amount: number; mode: string; reference: string }, actorId: string) => {
    expect(state.scope.getStore()).toBe(true);
    const { generateId } = await import("@/lib/id");
    const { postJournalEntry, SYSTEM_ACCOUNT_CODES: codes } = await import("@/lib/accounts/ledger");
    const id = generateId("OPY");
    seed(schema.orderPayments, { id, orderId, amount: String(input.amount), mode: input.mode, reference: input.reference, recordedBy: actorId });
    await postJournalEntry({ orgId: "ORG-test", description: "payment", sourceType: "ReceivablePayment", sourceId: id, createdBy: actorId,
      lines: [{ accountCode: codes.CUSTOMER_CREDIT_BALANCE, debit: input.amount }, { accountCode: codes.ACCOUNTS_RECEIVABLE, credit: input.amount }] });
  }),
}));
vi.mock("@/lib/auth/users", () => ({ listUsers: async () => [] }));
vi.mock("@/lib/purchase/orders", () => ({ loadPoLinesBatch: async () => new Map() }));
vi.mock("@/lib/tasks", () => ({ createTask: vi.fn() }));
vi.mock("@/lib/chatxflow", () => ({ sendWhatsAppMessage: vi.fn() }));
import { refundCreditNote, applyCreditNoteToOrder, createCreditNote } from "@/lib/accounts/creditNotes";
import { receiveDebitNotePayment, applyDebitNoteToBill, createDebitNote } from "@/lib/accounts/debitNotes";
import { createInvoice, updateInvoice, issueInvoice } from "@/lib/accounts/accounts";
import { createBill, updateBill, issueBill, recordBillPayment } from "@/lib/accounts/payables";
import { topUpPettyCash, recordPettyCashExpense } from "@/lib/accounts/pettyCash";
import { createExpenseEntry } from "@/lib/accounts/expenses";
import { SYSTEM_ACCOUNT_CODES as C } from "@/lib/accounts/ledger";
function seed(table: unknown, value: Record<string, unknown>) { rows(table).push({ orgId: "ORG-test", createdAt: new Date(), ...value }); }
beforeEach(() => {
  state.rows = {}; state.fail = ""; state.reads = []; state.writes = []; state.queue = Promise.resolve();
  for (const [name, code] of Object.entries(C)) seed(schema.chartOfAccounts, { id: name, code, name, type: name.endsWith("EXPENSE") ? "Expense" : "Asset", isSystem: true });
  seed(schema.creditNotes, { id: "CN", amount: "100", customerId: "CUSTOMER", creditNoteNo: "CN-0001", invoiceId: "historical", orderId: "ORDER", reason: "", gstAmount: "0", attachmentUrl: "", createdBy: "ACTOR" });
  seed(schema.customers, { id: "CUSTOMER", customerName: "customer" });
});
it("credit refund GL failure rolls usage back and permits a clean retry", async () => {
  state.fail = "journal_entries";
  await expect(refundCreditNote({ creditNoteId: "CN", amount: 60 }, "ACTOR")).rejects.toThrow("injected GL fault");
  expect(rows(schema.creditNoteUsages)).toEqual([]);
  state.fail = "";
  expect((await refundCreditNote({ creditNoteId: "CN", amount: 60 }, "ACTOR")).remainingBalance).toBe(40);
  expect(state.reads.every(Boolean)).toBe(true);
});
it("applyCreditNoteToOrder rolls usage and payment back on GL failure", async () => {
  seed(schema.orders, { id: "ORDER", customerId: "CUSTOMER", status: "Payment_Review" });
  state.fail = "journal_entries";
  await expect(applyCreditNoteToOrder({ creditNoteId: "CN", orderId: "ORDER", amount: 60 }, "ACTOR")).rejects.toThrow("injected GL fault");
  expect(rows(schema.creditNoteUsages)).toEqual([]);
  expect(rows(schema.orderPayments)).toEqual([]);
  state.fail = "";
  expect((await applyCreditNoteToOrder({ creditNoteId: "CN", orderId: "ORDER", amount: 60 }, "ACTOR")).remainingBalance).toBe(40);
  expect(state.reads.every(Boolean)).toBe(true);
});
it("receiveDebitNotePayment rolls usage and payment back on GL failure", async () => {
  seed(schema.debitNotes, { id: "DN", amount: "100", vendorId: "VENDOR", debitNoteNo: "DN-0001" }); seed(schema.vendors, { id: "VENDOR", vendorName: "vendor" });
  state.fail = "journal_entries";
  await expect(receiveDebitNotePayment({ debitNoteId: "DN", amount: 60 }, "ACTOR")).rejects.toThrow("injected GL fault");
  expect(rows(schema.debitNoteUsages)).toEqual([]);
  
  state.fail = "";
  expect((await receiveDebitNotePayment({ debitNoteId: "DN", amount: 60 }, "ACTOR")).remainingBalance).toBe(40);
  expect(state.reads.every(Boolean)).toBe(true);
});
it("applyDebitNoteToBill rolls usage and payment back on GL failure", async () => {
  seed(schema.debitNotes, { id: "DN", amount: "100", vendorId: "VENDOR", debitNoteNo: "DN-0001" }); seed(schema.vendors, { id: "VENDOR", vendorName: "vendor" }); seed(schema.bills, { id: "BILL", vendorId: "VENDOR", status: "Issued", amount: "100" });
  state.fail = "journal_entries";
  await expect(applyDebitNoteToBill({ debitNoteId: "DN", billId: "BILL", amount: 60 }, "ACTOR")).rejects.toThrow("injected GL fault");
  expect(rows(schema.debitNoteUsages)).toEqual([]);
  expect(rows(schema.billPayments)).toEqual([]);
  state.fail = "";
  expect((await applyDebitNoteToBill({ debitNoteId: "DN", billId: "BILL", amount: 60 }, "ACTOR")).remainingBalance).toBe(40);
  expect(state.reads.every(Boolean)).toBe(true);
});
it("issueInvoice does not report issuance when GL fails", async () => {
  seed(schema.orders, { id: "ORDER", orderValue: 100, gstAmount: 0, transportArrangedBy: "Party" }); seed(schema.invoices, { id: "INV", orderId: "ORDER", status: "Draft", finalValue: "100", gstAmount: "0", invoiceNo: "INV-1", invoiceAttachmentUrl: "doc" });
  state.fail = "journal_entries";
  await expect(issueInvoice("INV", "ACTOR")).rejects.toThrow("injected GL fault");
  expect(rows(schema.invoices)[0].status).toBe("Draft");
  state.fail = "";
  expect((await issueInvoice("INV", "ACTOR")).status).toBe("Issued");
  expect(state.reads.every(Boolean)).toBe(true);
});
it("issueBill does not report issuance when GL fails", async () => {
  seed(schema.bills, { id: "BILL", poId: "PO", vendorId: "VENDOR", status: "Draft", amount: "118", gstPercent: "18", gstAmount: "18", billNo: "B-1", billAttachmentUrl: "doc" });
  state.fail = "journal_entries";
  await expect(issueBill("BILL", "ACTOR")).rejects.toThrow("injected GL fault");
  expect(rows(schema.bills)[0].status).toBe("Draft");
  state.fail = "";
  expect((await issueBill("BILL", "ACTOR")).status).toBe("Issued");
  expect(state.reads.every(Boolean)).toBe(true);
});
it("bill payment GL failure rolls payment back", async () => {
  seed(schema.bills, { id: "BILL", vendorId: "VENDOR", status: "Issued", amount: "100" });
  state.fail = "journal_entries";
  await expect(recordBillPayment("BILL", { amount: 30, mode: "Cash" }, "ACTOR")).rejects.toThrow("injected GL fault");
  expect(rows(schema.billPayments)).toEqual([]);
  state.fail = "";
  await recordBillPayment("BILL", { amount: 30, mode: "Cash" }, "ACTOR");
  expect(rows(schema.billPayments)).toHaveLength(1);
  expect(state.reads.every(Boolean)).toBe(true);
});
it("equal bill payments have distinct immutable journal sources", async () => {
  seed(schema.bills, { id: "BILL", vendorId: "VENDOR", status: "Issued", amount: "100" });
  await recordBillPayment("BILL", { amount: 30, mode: "Cash" }, "ACTOR");
  await recordBillPayment("BILL", { amount: 30, mode: "Cash" }, "ACTOR");
  const payments = rows(schema.billPayments);
  expect(payments).toHaveLength(2);
  expect(rows(schema.journalEntries).map(row => row.sourceId)).toEqual(payments.map(row => row.id));
});
it("createCreditNote admission and document roll back with journal", async () => {
  seed(schema.orders, { id: "ORDER", customerId: "CUSTOMER" }); seed(schema.invoices, { id: "INV", orderId: "ORDER", status: "Issued", finalValue: "100", gstAmount: "0" });
  state.fail = "journal_entries";
  await expect(createCreditNote({ invoiceId: "INV", amount: 60 }, "ACTOR")).rejects.toThrow("injected GL fault");
  expect(rows(schema.creditNotes)).toHaveLength(1);
  state.fail = "";
  expect((await createCreditNote({ invoiceId: "INV", amount: 60 }, "ACTOR")).amount).toBe(60);
  expect(state.reads.every(Boolean)).toBe(true);
});
it("createDebitNote admission and document roll back with journal", async () => {
  seed(schema.vendors, { id: "VENDOR", vendorName: "vendor" });
  state.fail = "journal_entries";
  await expect(createDebitNote({ vendorId: "VENDOR", amount: 60 }, "ACTOR")).rejects.toThrow("injected GL fault");
  expect(rows(schema.debitNotes)).toHaveLength(0);
  state.fail = "";
  expect((await createDebitNote({ vendorId: "VENDOR", amount: 60 }, "ACTOR")).amount).toBe(60);
  expect(state.reads.every(Boolean)).toBe(true);
});
it("topUpPettyCash admission and document roll back with journal", async () => {
  
  state.fail = "journal_entries";
  await expect(topUpPettyCash({ amount: 60 }, "ACTOR")).rejects.toThrow("injected GL fault");
  expect(rows(schema.pettyCashEntries)).toHaveLength(0);
  state.fail = "";
  expect((await topUpPettyCash({ amount: 60 }, "ACTOR")).amount).toBe(60);
  expect(state.reads.every(Boolean)).toBe(true);
});
it("createExpenseEntry admission and document roll back with journal", async () => {
  
  state.fail = "journal_entries";
  await expect(createExpenseEntry({ categoryAccountId: "RENT_EXPENSE", amount: 60 }, "ACTOR")).rejects.toThrow("injected GL fault");
  expect(rows(schema.expenseEntries)).toHaveLength(0);
  state.fail = "";
  expect((await createExpenseEntry({ categoryAccountId: "RENT_EXPENSE", amount: 60 }, "ACTOR")).amount).toBe(60);
  expect(state.reads.every(Boolean)).toBe(true);
});
it("recordPettyCashExpense admits under the tenant lock", async () => {
  seed(schema.journalLines, { accountId: "PETTY_CASH", debit: "100", credit: "0" });
  const results = await Promise.allSettled([recordPettyCashExpense({ categoryAccountId: "RENT_EXPENSE", amount: 60 }, "ACTOR"), recordPettyCashExpense({ categoryAccountId: "RENT_EXPENSE", amount: 60 }, "ACTOR")]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(rows(schema.pettyCashEntries)).toHaveLength(1);
});
it("createInvoice admits under the tenant lock", async () => {
  seed(schema.orders, { id: "ORDER", orderValue: 100, gstAmount: 0, transportArrangedBy: "Party" });
  seed(schema.pdiInspections, { id: "PDI", orderId: "ORDER", status: "Passed" });
  const results = await Promise.allSettled([createInvoice({ orderId: "ORDER", finalValue: 60 }, "ACTOR"), createInvoice({ orderId: "ORDER", finalValue: 60 }, "ACTOR")]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(rows(schema.invoices)).toHaveLength(1);
});
it("createBill admits under the tenant lock", async () => {
  seed(schema.purchaseOrders, { id: "PO", vendorId: "VENDOR", status: "Completed", gstPercent: "18" });
  const results = await Promise.allSettled([createBill({ poId: "PO", amount: 118 }, "ACTOR"), createBill({ poId: "PO", amount: 118 }, "ACTOR")]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(rows(schema.bills)).toHaveLength(1);
});
it("updateInvoice admits under the tenant lock", async () => {
  seed(schema.orders, { id: "ORDER", orderValue: 100, gstAmount: 0, transportArrangedBy: "Party" });
  seed(schema.invoices, { id: "INV", orderId: "ORDER", status: "Draft", finalValue: "50", gstAmount: "0" });
  expect((await updateInvoice("INV", { finalValue: 60 })).finalValue).toBe(60);
  expect(state.reads.every(Boolean)).toBe(true);
});
it("updateBill admits under the tenant lock", async () => {
  seed(schema.bills, { id: "BILL", status: "Draft", amount: "100", gstPercent: "0" });
  expect((await updateBill("BILL", { amount: 60 })).amount).toBe(60);
  expect(state.reads.every(Boolean)).toBe(true);
});
it.each([Infinity, NaN, -Infinity])("direct finance commands reject nonfinite amount %s without writes", async amount => {
  await expect(topUpPettyCash({ amount }, "ACTOR")).rejects.toThrow();
  await expect(createExpenseEntry({ categoryAccountId: "RENT_EXPENSE", amount }, "ACTOR")).rejects.toThrow();
  await expect(refundCreditNote({ creditNoteId: "CN", amount }, "ACTOR")).rejects.toThrow();
  expect(rows(schema.pettyCashEntries)).toEqual([]);
  expect(rows(schema.expenseEntries)).toEqual([]);
  expect(rows(schema.creditNoteUsages)).toEqual([]);
});
it("bill payment admission rejects competing payments beyond remaining payable", async () => {
  seed(schema.bills, { id: "BILL", vendorId: "VENDOR", status: "Issued", amount: "100" });
  const results = await Promise.allSettled([recordBillPayment("BILL", { amount: 60, mode: "Cash" }, "ACTOR"), recordBillPayment("BILL", { amount: 60, mode: "Cash" }, "ACTOR")]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(rows(schema.billPayments)).toHaveLength(1);
});
it("credit refund API durably replays its key and rejects changed payload", async () => {
  const { POST } = await import("@/app/api/accounts/credit-notes/[creditNoteId]/refund/route");
  const request = (amount: number, key = "refund-key") => new Request("http://local/refund", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ amount }) });
  const context = { params: Promise.resolve({ creditNoteId: "CN" }) };
  const first = await POST(request(30), context);
  expect(first.status).toBe(200);
  const second = await POST(request(30), context);
  expect(second.status).toBe(200);
  expect(await second.json()).toEqual(await first.json());
  expect(rows(schema.creditNoteUsages)).toHaveLength(1);
  expect((await POST(request(31), context)).status).toBe(409);
  expect((await POST(request(30, "bad key"), context)).status).toBe(400);
});
it("API key validation bills/route.ts", async () => {
  const { POST } = await import("@/app/api/accounts/bills/route");
  const response = await POST(new Request("http://local/finance", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "bad key" }, body: JSON.stringify({"poId": "PO", "amount": 30}) }));
  expect(response.status).toBe(400);
  expect((await response.json()).error).toMatch(/Idempotency key must/);
  expect(state.reads).toEqual([]);
});
it("API key validation credit-notes/route.ts", async () => {
  const { POST } = await import("@/app/api/accounts/credit-notes/route");
  const response = await POST(new Request("http://local/finance", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "bad key" }, body: JSON.stringify({"invoiceId": "INV", "amount": 30}) }));
  expect(response.status).toBe(400);
  expect((await response.json()).error).toMatch(/Idempotency key must/);
  expect(state.reads).toEqual([]);
});
it("API key validation debit-notes/route.ts", async () => {
  const { POST } = await import("@/app/api/accounts/debit-notes/route");
  const response = await POST(new Request("http://local/finance", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "bad key" }, body: JSON.stringify({"vendorId": "VENDOR", "amount": 30}) }));
  expect(response.status).toBe(400);
  expect((await response.json()).error).toMatch(/Idempotency key must/);
  expect(state.reads).toEqual([]);
});
it("API key validation expenses/route.ts", async () => {
  const { POST } = await import("@/app/api/accounts/expenses/route");
  const response = await POST(new Request("http://local/finance", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "bad key" }, body: JSON.stringify({"categoryAccountId": "RENT_EXPENSE", "amount": 30}) }));
  expect(response.status).toBe(400);
  expect((await response.json()).error).toMatch(/Idempotency key must/);
  expect(state.reads).toEqual([]);
});
it("API key validation invoices/route.ts", async () => {
  const { POST } = await import("@/app/api/accounts/invoices/route");
  const response = await POST(new Request("http://local/finance", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "bad key" }, body: JSON.stringify({"orderId": "ORDER", "finalValue": 30}) }));
  expect(response.status).toBe(400);
  expect((await response.json()).error).toMatch(/Idempotency key must/);
  expect(state.reads).toEqual([]);
});
it("API key validation petty-cash/expense/route.ts", async () => {
  const { POST } = await import("@/app/api/accounts/petty-cash/expense/route");
  const response = await POST(new Request("http://local/finance", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "bad key" }, body: JSON.stringify({"categoryAccountId": "RENT_EXPENSE", "amount": 30}) }));
  expect(response.status).toBe(400);
  expect((await response.json()).error).toMatch(/Idempotency key must/);
  expect(state.reads).toEqual([]);
});
it("API key validation petty-cash/topup/route.ts", async () => {
  const { POST } = await import("@/app/api/accounts/petty-cash/topup/route");
  const response = await POST(new Request("http://local/finance", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "bad key" }, body: JSON.stringify({"amount": 30}) }));
  expect(response.status).toBe(400);
  expect((await response.json()).error).toMatch(/Idempotency key must/);
  expect(state.reads).toEqual([]);
});
it("API key validation ledger/accounts/route.ts", async () => {
  const { POST } = await import("@/app/api/accounts/ledger/accounts/route");
  const response = await POST(new Request("http://local/finance", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "bad key" }, body: JSON.stringify({"code": "NEW", "name": "new", "type": "Asset"}) }));
  expect(response.status).toBe(400);
  expect((await response.json()).error).toMatch(/Idempotency key must/);
  expect(state.reads).toEqual([]);
});
it("credit apply API replays its note usage and payment", async () => {
  seed(schema.orders, { id: "ORDER", customerId: "CUSTOMER", status: "Payment_Review" });
  const { POST } = await import("@/app/api/accounts/credit-notes/[creditNoteId]/apply/route");
  const context = { params: Promise.resolve({ creditNoteId: "CN" }) };
  const body = { orderId: "ORDER", amount: 20 };
  const first = await POST(financeRequest(body, "cn-key"), context);
  expect(first.status).toBe(200);
  const replay = await POST(financeRequest(body, "cn-key"), context);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(await first.json());
  expect(rows(schema.creditNoteUsages)).toHaveLength(1);
  expect(rows(schema.orderPayments)).toHaveLength(1);
  expect((await POST(financeRequest({ ...body, amount: 21 }, "cn-key"), context)).status).toBe(409);
  expect((await POST(financeRequest(body, "bad key"), context)).status).toBe(400);
});
it("debit apply API replays its note usage and payment", async () => {
  seed(schema.debitNotes, { id: "DN", amount: "100", vendorId: "VENDOR", debitNoteNo: "DN-1", reason: "", linkedFailureLogId: "", attachmentUrl: "", createdBy: "ACTOR" });
  seed(schema.bills, { id: "BILL", vendorId: "VENDOR", status: "Issued", amount: "100" });
  const { POST } = await import("@/app/api/accounts/debit-notes/[debitNoteId]/apply/route");
  const context = { params: Promise.resolve({ debitNoteId: "DN" }) };
  const body = { billId: "BILL", amount: 20 };
  const first = await POST(financeRequest(body, "dn-key"), context);
  expect(first.status).toBe(200);
  const replay = await POST(financeRequest(body, "dn-key"), context);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(await first.json());
  expect(rows(schema.debitNoteUsages)).toHaveLength(1);
  expect(rows(schema.billPayments)).toHaveLength(1);
  expect((await POST(financeRequest({ ...body, amount: 21 }, "dn-key"), context)).status).toBe(409);
  expect((await POST(financeRequest(body, "bad key"), context)).status).toBe(400);
});
it("debit receive API replays its cash usage", async () => {
  seed(schema.debitNotes, { id: "DN", amount: "100", vendorId: "VENDOR", debitNoteNo: "DN-1", reason: "", linkedFailureLogId: "", attachmentUrl: "", createdBy: "ACTOR" });
  const { POST } = await import("@/app/api/accounts/debit-notes/[debitNoteId]/receive/route");
  const context = { params: Promise.resolve({ debitNoteId: "DN" }) };
  const first = await POST(financeRequest({ amount: 20 }, "receive-key"), context);
  expect(first.status).toBe(200);
  const replay = await POST(financeRequest({ amount: "20" }, "receive-key"), context);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(await first.json());
  expect(rows(schema.debitNoteUsages)).toHaveLength(1);
  expect(rows(schema.journalEntries)).toHaveLength(1);
  expect((await POST(financeRequest({ amount: 21 }, "receive-key"), context)).status).toBe(409);
  expect((await POST(financeRequest({ amount: 20 }, "bad key"), context)).status).toBe(400);
});
it("manual journal API replays parsed dates and lines without duplicating an adjustment", async () => {
  const { POST } = await import("@/app/api/accounts/ledger/journal-entries/route");
  const body = { description: "adjustment", entryDate: "2026-10-09", lines: [{ accountId: "CASH_BANK", debit: 20 }, { accountId: "SALES_REVENUE", credit: 20 }] };
  const first = await POST(financeRequest(body, "manual-key"));
  expect(first.status).toBe(200);
  const replay = await POST(financeRequest(body, "manual-key"));
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(await first.json());
  expect(rows(schema.journalEntries)).toHaveLength(1);
  expect(rows(schema.journalEntries)[0].entryDate).toEqual(new Date("2026-10-08T18:30:00.000Z"));
  expect((await POST(financeRequest({ ...body, description: "different" }, "manual-key"))).status).toBe(409);
  expect((await POST(financeRequest(body, "bad key"))).status).toBe(400);
  expect((await POST(financeRequest(body, "manual-key-2"))).status).toBe(200);
  expect(rows(schema.journalEntries)).toHaveLength(2);
});
it("debit application shares the bill remaining-payable cap with cash payments", async () => {
  seed(schema.debitNotes, { id: "DN", amount: "100", vendorId: "VENDOR", debitNoteNo: "DN-1" });
  seed(schema.bills, { id: "BILL", vendorId: "VENDOR", status: "Issued", amount: "100" });
  const results = await Promise.allSettled([
    recordBillPayment("BILL", { amount: 60, mode: "Cash" }, "ACTOR"),
    applyDebitNoteToBill({ debitNoteId: "DN", billId: "BILL", amount: 60 }, "ACTOR"),
  ]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(rows(schema.billPayments)).toHaveLength(1);
  expect(rows(schema.debitNoteUsages)).toHaveLength(0);
});
it("manual journal resolves accounts inside its atomic tenant scope", async () => {
  const { createManualJournalEntry } = await import("@/lib/accounts/ledger");
  await createManualJournalEntry({ description: "adjustment", lines: [{ accountId: "CASH_BANK", debit: 10 }, { accountId: "SALES_REVENUE", credit: 10 }] }, "ACTOR");
  expect(state.reads.every(Boolean)).toBe(true);
});
it.each([Infinity, -Infinity, NaN, 0.001])("debit commands reject nonfinite or rounded-zero amount %s before writes", async amount => {
  seed(schema.vendors, { id: "VENDOR", vendorName: "vendor" });
  seed(schema.debitNotes, { id: "DN", amount: "100", vendorId: "VENDOR", debitNoteNo: "DN-1" });
  await expect(createDebitNote({ vendorId: "VENDOR", amount }, "ACTOR")).rejects.toThrow();
  await expect(receiveDebitNotePayment({ debitNoteId: "DN", amount }, "ACTOR")).rejects.toThrow();
  expect(rows(schema.debitNotes)).toHaveLength(1);
  expect(rows(schema.debitNoteUsages)).toHaveLength(0);
  expect(rows(schema.journalEntries)).toHaveLength(0);
});
it("lazy chart seeding admits before reading and writing defaults", async () => {
  state.rows.chart_of_accounts = [];
  const { seedDefaultChartOfAccounts } = await import("@/lib/accounts/ledger");
  await seedDefaultChartOfAccounts("ORG-test");
  expect(rows(schema.chartOfAccounts)).toHaveLength(Object.keys(C).length);
  expect(state.reads.every(Boolean)).toBe(true);
});
it("manual account creation keeps admission reads inside its tenant scope", async () => {
  const { createAccount } = await import("@/lib/accounts/ledger");
  await createAccount({ code: "9000", name: "custom", type: "Asset" });
  expect(state.reads.every(Boolean)).toBe(true);
  expect(rows(schema.chartOfAccounts).some(row => row.code === "9000")).toBe(true);
  expect(state.writes.every(Boolean)).toBe(true);
});
it("credit application joins the three-argument Orders payment path with immutable payment source", async () => {
  const { recordPayment } = await import("@/lib/orders/orders");
  vi.mocked(recordPayment).mockClear();
  seed(schema.orders, { id: "ORDER", customerId: "CUSTOMER", status: "Payment_Review" });
  await applyCreditNoteToOrder({ creditNoteId: "CN", orderId: "ORDER", amount: 20 }, "ACTOR");
  expect(recordPayment).toHaveBeenCalledExactlyOnceWith("ORDER", { amount: 20, mode: "Credit_Note", reference: "CN-0001" }, "ACTOR");
  expect(rows(schema.journalEntries).map(row => row.sourceId)).toEqual(rows(schema.orderPayments).map(row => row.id));
});
function financeRequest(body: unknown, key?: string) {
  return new Request("http://local/finance", { method: "POST", headers: {
    "Content-Type": "application/json", ...(key === undefined ? {} : { "Idempotency-Key": key }),
  }, body: JSON.stringify(body) });
}
it("bill payment API replays parsed payload without duplicating payment or journal", async () => {
  seed(schema.bills, { id: "BILL", vendorId: "VENDOR", status: "Issued", amount: "100", poId: "PO", billNo: "B-1", billAttachmentUrl: "doc", issuedBy: "ACTOR", createdBy: "ACTOR" });
  const { POST } = await import("@/app/api/accounts/bills/[billId]/payments/route");
  const context = { params: Promise.resolve({ billId: "BILL" }) };
  const first = await POST(financeRequest({ amount: "20", mode: "Cash", recordedBy: "FORGED" }, "bill-key"), context);
  expect(first.status).toBe(200);
  const replay = await POST(financeRequest({ amount: 20, mode: "Cash" }, "bill-key"), context);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual(await first.json());
  expect(rows(schema.billPayments)).toHaveLength(1);
  expect(rows(schema.journalEntries)).toHaveLength(1);
  expect(rows(schema.billPayments)[0].recordedBy).toBe("ACTOR");
  expect((await POST(financeRequest({ amount: 21, mode: "Cash" }, "bill-key"), context)).status).toBe(409);
  expect((await POST(financeRequest({ amount: 20, mode: "Cash" }, "bad key"), context)).status).toBe(400);
  expect((await POST(financeRequest({ amount: 20, mode: "Cash" }, "bill-key-2"), context)).status).toBe(200);
  expect(rows(schema.billPayments)).toHaveLength(2);
  expect(rows(schema.journalEntries).map(row => row.sourceId)).toEqual(rows(schema.billPayments).map(row => row.id));
});

