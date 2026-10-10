/* eslint-disable @typescript-eslint/no-explicit-any -- generic table fixture reader */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { organizations, indents, items, vendors, vendorItems, purchaseOrders, purchaseOrderLines, stockLedger, mutationReceipts, inwardIqcFms, failureLog, imsInward, tasks, settings, users, fmsTemplates, fmsRuns } from "../src/db/schema";
import { runWithTenant, type TenantContext } from "../src/lib/tenant";
import { createPurchaseOrder, receivePurchaseOrderLine, markFollowUpDone } from "../src/lib/purchase/orders";
import { receiveIndent, cancelIndent, approveIndent } from "../src/lib/inventory/indents";
import { submitQualityCheck, createInwardEntry } from "../src/lib/inward";
import { approveUnderDeviation, requestUnderDeviation, rejectUnderDeviation } from "../src/lib/inward/deviation";
const external = vi.hoisted(() => ({ upload: vi.fn(async () => ({ url: "https://example.invalid/generated.pdf" })), send: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/storage", () => ({ uploadAttachment: external.upload }));
vi.mock("@/lib/purchase/poPdf", () => ({ renderPurchaseOrderPdfBuffer: async () => Buffer.from("PDF boundary") }));
vi.mock("@/lib/chatxflow", () => ({ sendWhatsAppMessage: external.send }));
let orgId: string, sku: string, indentId: string, vendorId: string;
const actorId = "receipt-regression-actor";
function tenant<T>(work: () => Promise<T>) { return runWithTenant({ orgId } as TenantContext, work); }
async function all(table: any) { return db.select().from(table).where(eq(table.orgId, orgId)); }
async function fault(table: string, event: string, work: () => Promise<void>) {
  const name = `receipt_fault_${randomUUID().replaceAll("-", "")}`;
  const id = sql.identifier(name);
  try {
    await db.execute(sql`create function ${id}() returns trigger language plpgsql as ${sql.raw(`$$BEGIN IF NEW.org_id = '${orgId}' THEN RAISE EXCEPTION 'injected receipt fault'; END IF; RETURN NEW; END;$$`)}`);
    await db.execute(sql`create trigger ${id} before ${sql.raw(event)} on ${sql.identifier(table)} for each row execute function ${id}()`);
    await work();
  } finally {
    await db.execute(sql`drop trigger if exists ${id} on ${sql.identifier(table)}`);
    await db.execute(sql`drop function if exists ${id}()`);
  }
}
function issue() { return tenant(() => createPurchaseOrder({ vendorId, lines: [{ indentId }], attachmentUrl: "https://example.invalid/po.pdf", issuedBy: actorId })); }
beforeEach(async () => {
  external.upload.mockReset().mockResolvedValue({ url: "https://example.invalid/generated.pdf" });
  external.send.mockClear();
  expect((await db.execute(sql`select current_database() name`)).rows[0].name).toBe("pro_erp_test");
  orgId = `receipt-test-${randomUUID()}`; sku = `receipt-sku-${randomUUID()}`; indentId = `indent-${randomUUID()}`; vendorId = `vendor-${randomUUID()}`;
  await db.insert(organizations).values({ id: orgId, slug: orgId, orgName: "Receipt regression", ownerEmail: "receipt@example.invalid", plan: "Enterprise" });
  await db.insert(items).values({ sku, orgId, itemName: "Raw material", uom: "KG" });
  await db.insert(indents).values({ id: indentId, orgId, sku, itemName: "Raw material", uom: "KG", finalQty: "10", status: "Approved" });
  await db.insert(vendors).values({ id: vendorId, orgId, vendorName: "Supplier" });
  await db.insert(vendorItems).values({ id: `vi-${randomUUID()}`, orgId, vendorId, sku, unitPrice: "5", leadTimeDays: 1 });
});
afterEach(async () => {
  for (const table of [mutationReceipts, fmsRuns, fmsTemplates, settings, users, stockLedger, purchaseOrderLines, purchaseOrders, failureLog, imsInward, inwardIqcFms, tasks, indents, vendorItems, vendors, items]) {
    await db.delete(table).where(eq(table.orgId, orgId));
    expect(await all(table)).toEqual([]);
  }
  await db.delete(organizations).where(eq(organizations.id, orgId));
  expect(await db.select().from(organizations).where(eq(organizations.id, orgId))).toEqual([]);
});
it("rolls stock back when receipt status write fails and retry creates one movement", async () => {
  await fault("indents", "update", async () => {
    await expect(tenant(() => receiveIndent(indentId, 4, actorId))).rejects.toThrow();
    expect(await all(stockLedger)).toEqual([]);
    expect((await all(indents))[0].receivedQty).toBeNull();
  });
  await tenant(() => receiveIndent(indentId, 4, actorId));
  expect(await all(stockLedger)).toHaveLength(1);
  expect((await all(indents))[0].receivedQty).toBe("4");
});
it("rolls PO header back when a real PO line insert fails", async () => {
  await fault("purchase_order_lines", "insert", async () => {
    await expect(issue()).rejects.toThrow();
    expect(await all(purchaseOrders)).toEqual([]);
    expect(await all(purchaseOrderLines)).toEqual([]);
    expect((await all(indents))[0].status).toBe("Approved");
    expect((await all(indents))[0].poId).toBe("");
  });
});

async function seedInward() {
  const entryId = `inward-${randomUUID()}`;
  await db.insert(inwardIqcFms).values({ id: entryId, orgId, partyName: "Supplier", invoiceNo: "INV", sku, itemName: "Raw material" });
  return entryId;
}
async function seedFailure(requested = true) {
  const entryId = await seedInward();
  const id = `failure-${randomUUID()}`;
  await db.insert(failureLog).values({ id, orgId, linkedEntryId: entryId, partyName: "Supplier", failQty: "2", deviationRequestedAt: requested ? new Date() : null });
  return id;
}
async function configuredApprover() {
  const id = `approver-${randomUUID()}`;
  await db.insert(users).values({ id, orgId, fullName: "Approver", email: "approver@example.invalid", passwordHash: "not-a-real-password-hash", role: "IQC", phoneNumber: "" });
  await db.insert(settings).values({ orgId, key: "INWARD_IQC_DEVIATION_APPROVER", value: id });
  return { userId: id, role: "IQC" };
}
async function seedSuccessor(triggerEvent: string) {
  await db.insert(fmsTemplates).values({ templateId: `template-${randomUUID()}`, orgId, templateName: "Receipt successor", triggerEvent, stepNo: 1, stepName: "Review", tatValue: "1", tatUnit: "Hours" });
}

it("serializes competing PO issues so only one can claim the indent", async () => {
  const outcomes = await Promise.allSettled([issue(), issue()]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(await all(purchaseOrders)).toHaveLength(1);
  expect(await all(purchaseOrderLines)).toHaveLength(1);
  expect((await all(indents))[0].poId).toBe((await all(purchaseOrders))[0].id);
});
it("rolls PO lines and header back when the indent claim update fails", async () => {
  await fault("indents", "update", async () => {
    await expect(issue()).rejects.toThrow();
    expect(await all(purchaseOrders)).toEqual([]);
    expect(await all(purchaseOrderLines)).toEqual([]);
    expect((await all(indents))[0].poId).toBe("");
  });
});
it("replays a keyed PO issue with JSON dates without claiming twice", async () => {
  const input = { vendorId, lines: [{ indentId }], attachmentUrl: "po.pdf", issuedBy: actorId };
  const first = await tenant(() => createPurchaseOrder(input, "issue-key"));
  expect(await tenant(() => createPurchaseOrder(input, "issue-key"))).toEqual(first);
  expect(typeof first.issuedAt).toBe("string");
  expect(await all(purchaseOrders)).toHaveLength(1);
  expect(await all(purchaseOrderLines)).toHaveLength(1);
  expect(await all(mutationReceipts)).toHaveLength(1);
});
it("keeps generated PO claims and receipt committed on external PDF failure", async () => {
  external.upload.mockRejectedValueOnce(new Error("PDF upload fault"));
  const input = { vendorId, lines: [{ indentId }], attachmentUrl: "", generateAttachment: true, issuedBy: actorId };
  await expect(tenant(() => createPurchaseOrder(input, "pdf-key"))).rejects.toMatchObject({ committed: true });
  const replay = await tenant(() => createPurchaseOrder(input, "pdf-key"));
  expect(replay.id).toBe((await all(purchaseOrders))[0].id);
  expect(replay.attachmentUrl).toBe("");
  expect((await all(indents))[0].poId).toBe(replay.id);
  expect(await all(mutationReceipts)).toHaveLength(1);
  expect(external.upload).toHaveBeenCalledTimes(1);
});
it("commits two concurrent equal-valued partial deliveries with distinct keys", async () => {
  await Promise.all([tenant(() => receiveIndent(indentId, 3, actorId, undefined, "delivery-a")), tenant(() => receiveIndent(indentId, 3, actorId, undefined, "delivery-b"))]);
  expect((await all(indents))[0]).toMatchObject({ receivedQty: "6", status: "Partially_Received" });
  expect(await all(stockLedger)).toHaveLength(2);
  expect(await all(mutationReceipts)).toHaveLength(2);
});
it("concurrent receipt replay adds stock once and rejects changed payload/actor", async () => {
  const results = await Promise.all([tenant(() => receiveIndent(indentId, 3, actorId, undefined, "delivery")), tenant(() => receiveIndent(indentId, 3, actorId, undefined, "delivery"))]);
  expect(results[1]).toEqual(results[0]);
  await expect(tenant(() => receiveIndent(indentId, 4, actorId, undefined, "delivery"))).rejects.toMatchObject({ status: 409 });
  await expect(tenant(() => receiveIndent(indentId, 3, "different-actor", undefined, "delivery"))).rejects.toMatchObject({ status: 409 });
  expect(await all(stockLedger)).toHaveLength(1);
  expect((await all(indents))[0].receivedQty).toBe("3");
});
it("serializes competing unkeyed receipts against outstanding quantity", async () => {
  const results = await Promise.allSettled([tenant(() => receiveIndent(indentId, 7, actorId)), tenant(() => receiveIndent(indentId, 7, actorId))]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await all(indents))[0].receivedQty).toBe("7");
  expect(await all(stockLedger)).toHaveLength(1);
});
it("cannot cancel or directly receive a claimed PO indent", async () => {
  const po = await issue();
  await expect(tenant(() => cancelIndent(indentId))).rejects.toThrow("PO");
  await expect(tenant(() => receiveIndent(indentId, 2, actorId))).rejects.toThrow("PO");
  expect((await all(indents))[0]).toMatchObject({ status: "Ordered", poId: po.id });
  expect(await all(stockLedger)).toEqual([]);
});
it("rolls PO invoice, receipt marker and movement back on receipt header fault", async () => {
  const po = await issue();
  await tenant(() => markFollowUpDone(po.id, actorId, "done"));
  await fault("purchase_orders", "update", async () => {
    await expect(tenant(() => receivePurchaseOrderLine(po.id, indentId, 10, actorId, "invoice.pdf", "po-receipt"))).rejects.toThrow();
    expect((await all(purchaseOrders))[0]).toMatchObject({ status: "Open", invoiceUrl: "" });
    expect((await all(indents))[0].receivedQty).toBeNull();
    expect(await all(stockLedger)).toEqual([]);
    expect(await all(mutationReceipts)).toEqual([]);
  });
  const result = await tenant(() => receivePurchaseOrderLine(po.id, indentId, 10, actorId, "invoice.pdf", "po-receipt"));
  expect(await tenant(() => receivePurchaseOrderLine(po.id, indentId, 10, actorId, "invoice.pdf", "po-receipt"))).toEqual(result);
  expect((await all(purchaseOrders))[0]).toMatchObject({ status: "Completed", invoiceUrl: "invoice.pdf" });
  expect(await all(stockLedger)).toHaveLength(1);
  expect(await all(mutationReceipts)).toHaveLength(1);
});
it.each(["failure_log", "ims_inward", "stock_ledger"])("rolls IQC status and all routes back on %s fault", async (table) => {
  const entryId = await seedInward();
  const input = { entryId, verifiedBy: actorId, verifyChecked: true, passQty: 3, failQty: 2, failReason: "damaged" };
  await fault(table, "insert", async () => {
    await expect(tenant(() => submitQualityCheck(input, "iqc"))).rejects.toThrow();
    expect((await all(inwardIqcFms))[0].iqcStatus).toBe("Pending");
    expect(await all(failureLog)).toEqual([]);
    expect(await all(imsInward)).toEqual([]);
    expect(await all(stockLedger)).toEqual([]);
    expect(await all(mutationReceipts)).toEqual([]);
  });
  await tenant(() => submitQualityCheck(input, "iqc"));
  expect(await all(stockLedger)).toHaveLength(1);
});
it("concurrent IQC verification routes stock and failure quantity exactly once", async () => {
  const entryId = await seedInward();
  const input = { entryId, verifiedBy: actorId, verifyChecked: true, passQty: 3, failQty: 2, failReason: "damaged" };
  const results = await Promise.allSettled([tenant(() => submitQualityCheck(input)), tenant(() => submitQualityCheck(input))]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await all(stockLedger)).toHaveLength(1);
  expect(await all(failureLog)).toHaveLength(1);
  expect(await all(imsInward)).toHaveLength(1);
});
it("keyed concurrent IQC replay returns its DTO and routes once", async () => {
  const entryId = await seedInward();
  const input = { entryId, verifiedBy: actorId, verifyChecked: true, passQty: 3, failQty: 0, failReason: "" };
  const results = await Promise.all([tenant(() => submitQualityCheck(input, "iqc")), tenant(() => submitQualityCheck(input, "iqc"))]);
  expect(results[1]).toEqual(results[0]);
  expect(await all(stockLedger)).toHaveLength(1);
  expect(await all(imsInward)).toHaveLength(1);
  expect(await all(mutationReceipts)).toHaveLength(1);
});
it("rolls deviation movement and replay receipt back when its approval marker fails", async () => {
  const id = await seedFailure();
  const actor = { userId: actorId, role: "Admin" };
  await fault("failure_log", "update", async () => {
    await expect(tenant(() => approveUnderDeviation(id, actor, "deviation"))).rejects.toThrow();
    expect(await all(stockLedger)).toEqual([]);
    expect((await all(failureLog))[0].movedToInventoryAt).toBeNull();
    expect(await all(mutationReceipts)).toEqual([]);
  });
  await tenant(() => approveUnderDeviation(id, actor, "deviation"));
  await tenant(() => approveUnderDeviation(id, actor, "deviation"));
  expect(await all(stockLedger)).toHaveLength(1);
});
it("concurrent deviation approvals add the failed stock exactly once", async () => {
  const id = await seedFailure();
  const actor = { userId: actorId, role: "Admin" };
  const results = await Promise.allSettled([tenant(() => approveUnderDeviation(id, actor)), tenant(() => approveUnderDeviation(id, actor))]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await all(stockLedger)).toHaveLength(1);
  expect((await all(failureLog))[0].deviationApprovedBy).toBe(actorId);
});
it("rolls deviation request and receipt back if its required task insert fails", async () => {
  await configuredApprover();
  const id = await seedFailure(false);
  await fault("tasks", "insert", async () => {
    await expect(tenant(() => requestUnderDeviation(id, actorId, "request"))).rejects.toThrow();
    expect((await all(failureLog))[0].deviationRequestedAt).toBeNull();
    expect(await all(tasks)).toEqual([]);
    expect(await all(mutationReceipts)).toEqual([]);
    expect(external.send).not.toHaveBeenCalled();
  });
  await tenant(() => requestUnderDeviation(id, actorId, "request"));
  await tenant(() => requestUnderDeviation(id, actorId, "request"));
  expect(await all(tasks)).toHaveLength(1);
  expect(external.send).toHaveBeenCalledTimes(1);
});
it("deviation rejection replay cannot clear a later distinct request", async () => {
  const actor = await configuredApprover();
  const id = await seedFailure(false);
  await tenant(() => requestUnderDeviation(id, actorId, "request-1"));
  await tenant(() => rejectUnderDeviation(id, actor, "reject-1"));
  await tenant(() => requestUnderDeviation(id, actorId, "request-2"));
  await tenant(() => rejectUnderDeviation(id, actor, "reject-1"));
  expect((await all(failureLog))[0].deviationRequestedAt).not.toBeNull();
  expect(await all(tasks)).toHaveLength(2);
  expect(await all(stockLedger)).toEqual([]);
});
it.each(["inward", "indent"])("rolls %s admission back when a configured required FMS successor fails", async (kind) => {
  await seedSuccessor(kind === "inward" ? "INWARD_ENTRY_CREATED" : "INDENT_APPROVED");
  await fault("fms_runs", "insert", async () => {
    if (kind === "inward") {
      await expect(tenant(() => createInwardEntry({ partyName: "Supplier", invoiceNo: "INV", inwardType: "Other", attachmentUrl: "", remark: "", createdBy: actorId }, "inward-create"))).rejects.toThrow();
      expect(await all(inwardIqcFms)).toEqual([]);
      expect(await all(mutationReceipts)).toEqual([]);
    } else {
      await db.update(indents).set({ status: "Pending" }).where(eq(indents.id, indentId));
      await expect(tenant(() => approveIndent(indentId, actorId))).rejects.toThrow();
      expect((await all(indents))[0].status).toBe("Pending");
    }
    expect(await all(fmsRuns)).toEqual([]);
  });
});
