import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations, journalEntries, journalLines, chartOfAccounts, creditNotes, creditNoteUsages, debitNotes, debitNoteUsages, orders, orderActivities, orderPayments, bills, billPayments, invoices, pdiInspections, purchaseOrders, mutationReceipts, pettyCashEntries, expenseEntries, customers, vendors } from "@/db/schema";
import { refundCreditNote, applyCreditNoteToOrder, createCreditNote } from "@/lib/accounts/creditNotes";
import { receiveDebitNotePayment, applyDebitNoteToBill, createDebitNote } from "@/lib/accounts/debitNotes";
import { recordBillPayment, createBill, issueBill } from "@/lib/accounts/payables";
import { topUpPettyCash, recordPettyCashExpense } from "@/lib/accounts/pettyCash";
import { postJournalEntry, createManualJournalEntry, SYSTEM_ACCOUNT_CODES as C } from "@/lib/accounts/ledger";
const orgId = `ORG-finance-test-${randomUUID()}`;
const actorId = "USR-finance-test";
const fault = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/db/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/db/client")>();
  return { ...original, db: new Proxy(original.db, { get(target, property) {
    if (property === "batch") return (...args: Parameters<typeof target.batch>) => fault.enabled ? target.execute(sql`select 1/0`) : target.batch(...args);
    return Reflect.get(target, property);
  } }) };
});
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => orgId }));
vi.mock("@/lib/auth/guard", () => ({
  requireModule: async () => ({ ok: true, session: { userId: actorId, orgId, role: "Admin" } }),
}));
beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL!);
  if (target.hostname !== "pro-erp-regression-pg" || target.pathname !== "/pro_erp_test" || target.username !== "pro_erp_test" || target.port !== "5432") throw new Error("Disposable DB required");
  await db.insert(organizations).values({ id: orgId, orgName: "Finance test", slug: orgId, ownerEmail: "finance@example.invalid" });
});
afterAll(async () => {
  for (const table of [mutationReceipts, creditNoteUsages, debitNoteUsages, creditNotes, debitNotes, orderPayments, orderActivities, billPayments, invoices, bills, pdiInspections, orders, purchaseOrders, pettyCashEntries, expenseEntries, journalLines, journalEntries, chartOfAccounts, customers, vendors]) await db.delete(table).where(eq(table.orgId, orgId));
  await db.delete(organizations).where(eq(organizations.id, orgId));
  expect(await db.select().from(organizations).where(eq(organizations.id, orgId))).toHaveLength(0);
});
it.each([NaN, Infinity, -Infinity])("rejects nonfinite journal amounts %s without posting", async (amount) => {
  await expect(postJournalEntry(journal("nonfinite", amount))).rejects.toThrow(/finite/i);
  expect(await db.select().from(journalEntries).where(and(eq(journalEntries.orgId, orgId), eq(journalEntries.sourceId, "nonfinite")))).toHaveLength(0);
});
it("immutable source mismatch is a conflict; empty sources remain independent", async () => {
  await postJournalEntry(journal("conflict"));
  await expect(postJournalEntry(journal("conflict", 11))).rejects.toMatchObject({ status: 409 });
  const ids = await Promise.all([postJournalEntry(journal("")), postJournalEntry(journal(""))]);
  expect(ids[0]).not.toBe(ids[1]);
});
const journal = (sourceId: string, amount = 10) => ({ orgId, description: "test", sourceType: "FinanceTest", sourceId, createdBy: "USR-test", lines: [{ accountCode: C.CASH_BANK, debit: amount }, { accountCode: C.SALES_REVENUE, credit: amount }] });
it("concurrent identical immutable events post a single journal", async () => {
  const results = await Promise.all([postJournalEntry(journal("event-1")), postJournalEntry(journal("event-1"))]);
  expect(results[0]).toBe(results[1]);
  expect(await db.select().from(journalEntries).where(and(eq(journalEntries.orgId, orgId), eq(journalEntries.sourceId, "event-1")))).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Fixtures for the real-contention coverage below — every id is unique per test
// (this file has no afterEach reset; only afterAll cleans up at the end).
// ---------------------------------------------------------------------------
async function seedCreditNote(amount: number) {
  const tag = randomUUID();
  const customerId = `cust-${tag}`, theOrderId = `order-${tag}`, invoiceId = `inv-${tag}`;
  await db.insert(customers).values({ id: customerId, orgId, customerName: "Fixture customer" });
  await db.insert(orders).values({ id: theOrderId, orgId, status: "Payment_Review", customerId });
  await db.insert(invoices).values({ id: invoiceId, orgId, orderId: theOrderId, status: "Issued", finalValue: String(amount) });
  const note = await createCreditNote({ invoiceId, amount }, actorId);
  return { noteId: note.id, orderId: theOrderId, customerId };
}
async function seedDebitNote(amount: number) {
  const vendorId = `vendor-${randomUUID()}`;
  await db.insert(vendors).values({ id: vendorId, orgId, vendorName: "Fixture vendor" });
  const note = await createDebitNote({ vendorId, amount }, actorId);
  return { noteId: note.id, vendorId };
}
async function seedDebitNoteForVendor(vendorId: string, amount: number) {
  const note = await createDebitNote({ vendorId, amount }, actorId);
  return { noteId: note.id, vendorId };
}
async function seedIssuedBill(amount: number): Promise<{ billId: string; vendorId: string }> {
  const tag = randomUUID();
  const vendorId = `vendor-${tag}`, poId = `po-${tag}`;
  await db.insert(vendors).values({ id: vendorId, orgId, vendorName: "Fixture vendor" });
  await db.insert(purchaseOrders).values({ id: poId, orgId, vendorId, status: "Completed" });
  const bill = await createBill({ poId, billNo: `BN-${tag}`, billAttachmentUrl: "https://example.invalid/bill.pdf", amount }, actorId);
  await issueBill(bill.id, actorId);
  return { billId: bill.id, vendorId };
}
async function billRow(billId: string) {
  const [row] = await db.select().from(bills).where(eq(bills.id, billId));
  return row;
}
async function totalPaidOn(billId: string) {
  const rows = await db.select().from(billPayments).where(eq(billPayments.billId, billId));
  return rows.reduce((sum, r) => sum + Number(r.amount), 0);
}

// ---------------------------------------------------------------------------
// Real concurrent balance-cap contention — Credit Notes / Debit Notes / Bills
// ---------------------------------------------------------------------------
it("concurrent CN apply + refund past its balance admits exactly one", async () => {
  const { noteId, orderId: order1 } = await seedCreditNote(100);
  const outcomes = await Promise.allSettled([
    applyCreditNoteToOrder({ creditNoteId: noteId, orderId: order1, amount: 70 }, actorId),
    refundCreditNote({ creditNoteId: noteId, amount: 70 }, actorId),
  ]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
  const usages = await db.select().from(creditNoteUsages).where(eq(creditNoteUsages.creditNoteId, noteId));
  expect(usages).toHaveLength(1);
  const payments = await db.select().from(orderPayments).where(eq(orderPayments.orgId, orgId));
  expect(payments.filter((p) => p.mode === "Credit_Note")).toHaveLength(usages[0].kind === "Applied" ? 1 : 0);
});
it("concurrent DN apply + receive past its balance admits exactly one", async () => {
  const { noteId } = await seedDebitNote(100);
  const { billId } = await seedIssuedBill(200);
  const outcomes = await Promise.allSettled([
    applyDebitNoteToBill({ debitNoteId: noteId, billId, amount: 70 }, actorId),
    receiveDebitNotePayment({ debitNoteId: noteId, amount: 70 }, actorId),
  ]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
  const usages = await db.select().from(debitNoteUsages).where(eq(debitNoteUsages.debitNoteId, noteId));
  expect(usages).toHaveLength(1);
});
it("concurrent cash payment and DN-apply stay within the bill's remaining payable", async () => {
  const { billId, vendorId } = await seedIssuedBill(100);
  const { noteId } = await seedDebitNoteForVendor(vendorId, 100);
  const outcomes = await Promise.allSettled([
    recordBillPayment(billId, { amount: 70, mode: "Cash" }, actorId),
    applyDebitNoteToBill({ debitNoteId: noteId, billId, amount: 70 }, actorId),
  ]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(await totalPaidOn(billId)).toBeLessThanOrEqual(100);
});
it("concurrent double-issue of one bill posts exactly one journal entry", async () => {
  const tag = randomUUID();
  const vendorId = `vendor-${tag}`, poId = `po-${tag}`;
  await db.insert(vendors).values({ id: vendorId, orgId, vendorName: "Fixture vendor" });
  await db.insert(purchaseOrders).values({ id: poId, orgId, vendorId, status: "Completed" });
  const draft = await createBill({ poId, billNo: `BN-${tag}`, billAttachmentUrl: "https://example.invalid/bill.pdf", amount: 50 }, actorId);
  const outcomes = await Promise.allSettled([issueBill(draft.id, actorId), issueBill(draft.id, actorId)]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect((await billRow(draft.id)).status).toBe("Issued");
  const lines = await db.select().from(journalEntries).where(and(eq(journalEntries.orgId, orgId), eq(journalEntries.sourceType, "Bill"), eq(journalEntries.sourceId, draft.id)));
  expect(lines).toHaveLength(1);
});
it("concurrent createBill for the same PO admits exactly one row", async () => {
  const tag = randomUUID();
  const vendorId = `vendor-${tag}`, poId = `po-${tag}`;
  await db.insert(vendors).values({ id: vendorId, orgId, vendorName: "Fixture vendor" });
  await db.insert(purchaseOrders).values({ id: poId, orgId, vendorId, status: "Completed" });
  const outcomes = await Promise.allSettled([
    createBill({ poId, amount: 40 }, actorId),
    createBill({ poId, amount: 40 }, actorId),
  ]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rejected = outcomes.find((r) => r.status === "rejected");
  expect(rejected && (rejected as PromiseRejectedResult).reason).toMatchObject({ message: expect.stringContaining("Bill") });
  expect(await db.select().from(bills).where(eq(bills.poId, poId))).toHaveLength(1);
});
it("concurrent petty cash expenses past the fund balance admit exactly one", async () => {
  await topUpPettyCash({ amount: 50 }, actorId);
  const accounts = await db.select().from(chartOfAccounts).where(and(eq(chartOfAccounts.orgId, orgId), eq(chartOfAccounts.code, C.MISC_EXPENSE)));
  const categoryAccountId = accounts[0].id;
  const outcomes = await Promise.allSettled([
    recordPettyCashExpense({ categoryAccountId, amount: 30 }, actorId),
    recordPettyCashExpense({ categoryAccountId, amount: 30 }, actorId),
  ]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Injected GL/receipt faults — real SQL failure mid-transaction, then retry/readback
// ---------------------------------------------------------------------------
it("a GL fault rolls back CN usage and Orders' payment together; retry commits once", async () => {
  const { noteId, orderId } = await seedCreditNote(50);
  fault.enabled = true;
  try {
    await expect(applyCreditNoteToOrder({ creditNoteId: noteId, orderId, amount: 20 }, actorId)).rejects.toThrow();
  } finally {
    fault.enabled = false;
  }
  expect(await db.select().from(creditNoteUsages).where(eq(creditNoteUsages.creditNoteId, noteId))).toHaveLength(0);
  expect(await db.select().from(orderPayments).where(eq(orderPayments.orderId, orderId))).toHaveLength(0);
  const applied = await applyCreditNoteToOrder({ creditNoteId: noteId, orderId, amount: 20 }, actorId);
  expect(applied.remainingBalance).toBe(30);
  expect(await db.select().from(creditNoteUsages).where(eq(creditNoteUsages.creditNoteId, noteId))).toHaveLength(1);
});
it("a GL fault rolls back a manual journal entirely; retry posts exactly one", async () => {
  const accounts = await db.select().from(chartOfAccounts).where(eq(chartOfAccounts.orgId, orgId));
  const cash = accounts.find((a) => a.code === C.CASH_BANK)!;
  const misc = accounts.find((a) => a.code === C.MISC_EXPENSE)!;
  const input = { description: "fault-probe adjustment", lines: [{ accountId: cash.id, debit: 15 }, { accountId: misc.id, credit: 15 }] };
  const before = await db.select().from(journalEntries).where(and(eq(journalEntries.orgId, orgId), eq(journalEntries.sourceType, "Manual")));
  fault.enabled = true;
  try {
    await expect(createManualJournalEntry(input, actorId)).rejects.toThrow();
  } finally {
    fault.enabled = false;
  }
  const afterFault = await db.select().from(journalEntries).where(and(eq(journalEntries.orgId, orgId), eq(journalEntries.sourceType, "Manual")));
  expect(afterFault).toHaveLength(before.length);
  await createManualJournalEntry(input, actorId);
  const afterRetry = await db.select().from(journalEntries).where(and(eq(journalEntries.orgId, orgId), eq(journalEntries.sourceType, "Manual")));
  expect(afterRetry).toHaveLength(before.length + 1);
});

// ---------------------------------------------------------------------------
// Each finance route's own durable (keyed) HTTP replay — real DB, auth boundary mocked
// ---------------------------------------------------------------------------
function jsonRequest(body: unknown, key: string) {
  return new Request("http://local.invalid/test", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}
it("bill payment route replays a keyed request and conflicts on a changed payload", async () => {
  const { POST } = await import("@/app/api/accounts/bills/[billId]/payments/route");
  const { billId } = await seedIssuedBill(100);
  const params = Promise.resolve({ billId });
  const key = `bill-pay-${randomUUID()}`;
  const first = await POST(jsonRequest({ amount: 30, mode: "Cash" }, key), { params });
  const replay = await POST(jsonRequest({ amount: 30, mode: "Cash" }, key), { params });
  expect(first.status).toBe(200);
  expect(await first.clone().json()).toEqual(await replay.clone().json());
  expect(await totalPaidOn(billId)).toBe(30);
  const conflict = await POST(jsonRequest({ amount: 31, mode: "Cash" }, key), { params });
  expect(conflict.status).toBe(409);
});
it("CN apply route replays a keyed request and conflicts on a changed payload", async () => {
  const { POST } = await import("@/app/api/accounts/credit-notes/[creditNoteId]/apply/route");
  const { noteId, orderId } = await seedCreditNote(60);
  const params = Promise.resolve({ creditNoteId: noteId });
  const key = `cn-apply-${randomUUID()}`;
  const first = await POST(jsonRequest({ orderId, amount: 25 }, key), { params });
  const replay = await POST(jsonRequest({ orderId, amount: 25 }, key), { params });
  expect(first.status).toBe(200);
  expect(await first.clone().json()).toEqual(await replay.clone().json());
  expect(await db.select().from(creditNoteUsages).where(eq(creditNoteUsages.creditNoteId, noteId))).toHaveLength(1);
  const conflict = await POST(jsonRequest({ orderId, amount: 26 }, key), { params });
  expect(conflict.status).toBe(409);
});
it("DN apply route replays a keyed request and conflicts on a changed payload", async () => {
  const { POST } = await import("@/app/api/accounts/debit-notes/[debitNoteId]/apply/route");
  const { billId, vendorId } = await seedIssuedBill(100);
  const { noteId } = await seedDebitNoteForVendor(vendorId, 60);
  const params = Promise.resolve({ debitNoteId: noteId });
  const key = `dn-apply-${randomUUID()}`;
  const first = await POST(jsonRequest({ billId, amount: 20 }, key), { params });
  const replay = await POST(jsonRequest({ billId, amount: 20 }, key), { params });
  expect(first.status).toBe(200);
  expect(await first.clone().json()).toEqual(await replay.clone().json());
  expect(await db.select().from(debitNoteUsages).where(eq(debitNoteUsages.debitNoteId, noteId))).toHaveLength(1);
});
it("DN receive route replays a keyed request and conflicts on a changed payload", async () => {
  const { POST } = await import("@/app/api/accounts/debit-notes/[debitNoteId]/receive/route");
  const { noteId } = await seedDebitNote(60);
  const params = Promise.resolve({ debitNoteId: noteId });
  const key = `dn-receive-${randomUUID()}`;
  const first = await POST(jsonRequest({ amount: 20 }, key), { params });
  const replay = await POST(jsonRequest({ amount: 20 }, key), { params });
  expect(first.status).toBe(200);
  expect(await first.clone().json()).toEqual(await replay.clone().json());
  expect(await db.select().from(debitNoteUsages).where(eq(debitNoteUsages.debitNoteId, noteId))).toHaveLength(1);
  const conflict = await POST(jsonRequest({ amount: 21 }, key), { params });
  expect(conflict.status).toBe(409);
});
it("manual journal route replays a keyed request and conflicts on a changed payload", async () => {
  const { POST } = await import("@/app/api/accounts/ledger/journal-entries/route");
  const accounts = await db.select().from(chartOfAccounts).where(eq(chartOfAccounts.orgId, orgId));
  const cash = accounts.find((a) => a.code === C.CASH_BANK)!;
  const misc = accounts.find((a) => a.code === C.MISC_EXPENSE)!;
  const key = `manual-journal-${randomUUID()}`;
  const body = { description: "route replay probe", lines: [{ accountId: cash.id, debit: 12 }, { accountId: misc.id, credit: 12 }] };
  const first = await POST(jsonRequest(body, key));
  const replay = await POST(jsonRequest(body, key));
  expect(first.status).toBe(200);
  expect(await first.clone().json()).toEqual(await replay.clone().json());
  const entryId = (await first.clone().json()).id as string;
  expect(await db.select().from(journalLines).where(eq(journalLines.entryId, entryId))).toHaveLength(2);
  const conflict = await POST(jsonRequest({ ...body, lines: [{ accountId: cash.id, debit: 13 }, { accountId: misc.id, credit: 13 }] }, key));
  expect(conflict.status).toBe(409);
});

