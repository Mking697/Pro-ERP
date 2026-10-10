/* eslint-disable @typescript-eslint/no-explicit-any -- minimal persistence boundary simulator */
import { beforeEach, expect, it, vi } from "vitest";

// Persistence and external boundaries only are simulated; the domain modules are real.
const h = vi.hoisted(() => {
  type Row = Record<string, any>;
  const tables = Object.fromEntries(["indents", "purchaseOrders", "purchaseOrderLines", "vendors", "inwardIqcFms", "failureLog", "imsInward"].map((name) => [name, Object.fromEntries(["id", "orgId", "status", "poId", "indentId"].map((key) => [key, key]).concat([["name", name]]))]));
  const state = { rows: {} as Record<string, Row[]>, movements: [] as Row[], effects: [] as (() => Promise<void>)[], active: false, fail: "", receipts: new Map<string, { binding: string; result: any }>(), events: [] as string[] };
  let queue = Promise.resolve();
  const tx = vi.fn(async (_org: string, work: () => Promise<any>) => {
    if (state.active) return work();
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const snapshot = structuredClone({ rows: state.rows, movements: state.movements });
    state.active = true; state.events.push("admit");
    try {
      const result = await work();
      state.active = false; state.events.push("commit");
      const effects = state.effects.splice(0);
      for (const effect of effects) await effect();
      return result;
    } catch (error) {
      state.rows = snapshot.rows; state.movements = snapshot.movements; state.effects = [];
      throw error;
    } finally { state.active = false; release(); }
  });
  function read(table: { name: string }, org: string, id: string) {
    state.events.push(`read:${table.name}:${state.active}`);
    return state.rows[table.name]?.find((r) => r.id === id && r.orgId === org) ?? null;
  }
  const update = vi.fn(async (table: { name: string }, org: string, id: string, patch: Row) => {
    if (state.fail === `update:${table.name}`) throw new Error("injected update fault");
    const row = read(table, org, id);
    if (!row) return null;
    Object.assign(row, patch); return row;
  });
  const insert = vi.fn(async (table: { name: string }, row: Row) => {
    if (state.fail === `insert:${table.name}`) throw new Error("injected insert fault");
    const saved = { timestamp: new Date(), invoiceUrl: "", followUpDoneBy: "", followUpRemark: "", ...row };
    (state.rows[table.name] ??= []).push(saved); return saved;
  });
  const movement = vi.fn(async (input: Row) => {
    if (state.fail === "movement") throw new Error("injected ledger fault");
    state.movements.push(input);
  });
  const mutation = vi.fn(async (org: string, opts: Row, work: () => Promise<any>) => {
    if (state.active) throw new Error("nested idempotent helper");
    return tx(org, async () => {
      const binding = JSON.stringify({ actor: opts.actorId, operation: opts.operation, payload: opts.payload });
      const saved = opts.key === undefined ? undefined : state.receipts.get(opts.key);
      if (saved) { if (binding !== saved.binding) throw new Error("mutation conflict"); return structuredClone(saved.result); }
      const result = await work();
      if (opts.key !== undefined) state.receipts.set(opts.key, { binding, result: structuredClone(result) });
      return result;
    });
  });
  const select = () => ({ from: (table: { name: string }) => {
    let predicate: (r: Row) => boolean = () => true;
    const query = { where: (p: (r: Row) => boolean) => { predicate = p; return query; }, limit: () => query, orderBy: () => query, then: (resolve: (rows: Row[]) => unknown) => Promise.resolve((state.rows[table.name] ?? []).filter(predicate)).then(resolve) };
    return query;
  } });
  return { tables, state, tx, read, update, insert, movement, mutation, select, item: vi.fn(async () => ({ UOM: "KG", Location: "Store" })), event: vi.fn(async () => {}), task: vi.fn(async () => ({})), send: vi.fn(async () => ({ ok: true })), upload: vi.fn(async () => ({ url: "https://example.invalid/generated.pdf" })) };
});
vi.mock("drizzle-orm", () => ({ eq: (column: string, value: unknown) => (row: Record<string, unknown>) => row[column] === value, and: (...predicates: ((row: any) => boolean)[]) => (row: any) => predicates.every((p) => p(row)), inArray: (column: string, values: unknown[]) => (row: any) => values.includes(row[column]), desc: (column: string) => column }));
vi.mock("@/db/schema", () => h.tables);
vi.mock("@/db/client", () => ({ db: { select: h.select }, runInTenantTransaction: h.tx, isInTenantTransaction: () => h.state.active, afterTenantCommit: async (effect: () => Promise<void>) => { if (h.state.active) h.state.effects.push(effect); else await effect(); } }));
vi.mock("@/db/repo", () => ({ findById: h.read, updateById: h.update, insertRecord: h.insert, listByOrg: async (table: { name: string }, org: string) => (h.state.rows[table.name] ?? []).filter((r) => r.orgId === org) }));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "org" }));
vi.mock("@/lib/id", () => ({ generateId: (prefix: string) => `${prefix}-${crypto.randomUUID()}` }));
vi.mock("@/lib/inventory/ledger", () => ({ recordMovement: h.movement }));
vi.mock("@/lib/inventory/items", () => ({ findItem: h.item, numOr0: (n: unknown) => Number(n) || 0, num: (n: unknown) => Number(n) || null }));
vi.mock("@/lib/fms/engine", () => ({ emitFmsEvent: h.event }));
vi.mock("@/lib/fms/calendar", () => ({ computeDefaultTatDeadline: async () => Date.now(), computeTatDeadline: async () => Date.now() }));
vi.mock("@/lib/settings", () => ({ getSetting: async (key: string) => key === "INWARD_IQC_DEVIATION_APPROVER" ? "approver" : "" }));
vi.mock("@/lib/purchase/settings", () => ({ getPurchaseSetup: async () => ({ gstPercentDefault: 0, defaultTerms: "", defaultNote: "" }) }));
vi.mock("@/lib/parties/vendorItems", () => ({ getVendorItemLink: async () => ({ unitPrice: "5", leadTimeDays: 1 }), listVendorsForSkus: async () => new Map() }));
vi.mock("@/lib/leads/quotationSetup", () => ({ getQuotationSetup: async () => ({}) }));
vi.mock("@/lib/storage", () => ({ uploadAttachment: h.upload }));
vi.mock("@/lib/purchase/poPdf", () => ({ renderPurchaseOrderPdfBuffer: async () => Buffer.from("PDF") }));
vi.mock("@/lib/auth/users", () => ({ getUserById: async () => ({ User_ID: "approver", Full_Name: "Approver", Phone_Number: "0000000000" }) }));
vi.mock("@/lib/tasks", () => ({ createTask: h.task }));
vi.mock("@/lib/chatxflow", () => ({ sendWhatsAppMessage: h.send }));
vi.mock("@/lib/mutations", async (importOriginal) => ({ ...await importOriginal<typeof import("../src/lib/mutations")>(), runIdempotentTenantMutation: h.mutation }));
vi.mock("@/lib/auth/guard", () => ({ requireModule: async () => ({ ok: true, session: { userId: "actor", role: "Admin" }, tenant: { orgId: "org" } }) }));

import { approveIndent, cancelIndent, receiveIndent, receiveIndentForPurchaseOrder } from "../src/lib/inventory/indents";
import { createPurchaseOrder, receivePurchaseOrderLine, markFollowUpDone } from "../src/lib/purchase/orders";
import { submitQualityCheck, createInwardEntry } from "../src/lib/inward";
import { approveUnderDeviation, requestUnderDeviation, rejectUnderDeviation } from "../src/lib/inward/deviation";

beforeEach(() => {
  vi.clearAllMocks();
  h.state.rows = { indents: [{ id: "indent", orgId: "org", timestamp: new Date(), sku: "sku", itemName: "Material", uom: "KG", reason: "Reorder", finalQty: "10", receivedQty: null, status: "Approved", poId: "" }], vendors: [{ id: "vendor", orgId: "org", vendorName: "Supplier" }] };
  h.state.movements = []; h.state.effects = []; h.state.events = []; h.state.receipts.clear(); h.state.fail = ""; h.state.active = false;
  h.item.mockResolvedValue({ UOM: "KG", Location: "Store" });
  h.event.mockReset().mockResolvedValue(undefined);
  h.task.mockReset().mockResolvedValue({});
  h.send.mockReset().mockResolvedValue({ ok: true });
});

it("rolls back an indent movement when the receipt status write fails", async () => {
  h.state.fail = "update:indents";
  await expect(receiveIndent("indent", 4, "actor")).rejects.toThrow("injected update fault");
  expect(h.state.movements).toEqual([]);
});

it("binds a supplied receipt identity once while equal quantities with different identities both arrive", async () => {
  const first = await receiveIndent("indent", 3, "actor", undefined, "delivery-1");
  const replay = await receiveIndent("indent", 3, "actor", undefined, "delivery-1");
  await receiveIndent("indent", 3, "actor", undefined, "delivery-2");
  expect(replay).toEqual(first);
  expect(h.state.rows.indents[0].receivedQty).toBe("6");
  expect(h.state.movements).toHaveLength(2);
  expect(h.mutation.mock.calls[0][1]).toMatchObject({ actorId: "actor", key: "delivery-1", operation: "inventory.indent.receive.v1", payload: { indentId: "indent", receivedNow: 3 } });
});

it.each(["NaN", "Infinity", "broken"])("rejects corrupt persisted outstanding quantity %s without adding stock", async (quantity) => {
  h.state.rows.indents[0].finalQty = quantity;
  await expect(receiveIndent("indent", 1, "actor")).rejects.toThrow();
  expect(h.state.movements).toEqual([]);
});

function inwardRow() {
  return { id: "inward", orgId: "org", timestamp: new Date(), partyName: "Supplier", invoiceNo: "INV", inwardType: "Purchase", attachmentUrl: "", remark: "", vendorId: "vendor", sku: "sku", itemName: "Material", iqcStatus: "Pending", verifiedBy: "", createdBy: "actor" };
}
const quality = { entryId: "inward", verifiedBy: "actor", verifyChecked: true, passQty: 3, failQty: 2, failReason: "damage" };

it("rolls IQC approval and both routes back when the stock writer fails", async () => {
  h.state.rows.inwardIqcFms = [inwardRow()];
  h.state.fail = "movement";
  await expect(submitQualityCheck(quality)).rejects.toThrow("injected ledger fault");
  expect(h.state.rows.inwardIqcFms[0].iqcStatus).toBe("Pending");
  expect(h.state.rows.failureLog ?? []).toEqual([]);
  expect(h.state.rows.imsInward ?? []).toEqual([]);
});

it("replays a keyed IQC result without rerouting stock", async () => {
  h.state.rows.inwardIqcFms = [inwardRow()];
  const first = await submitQualityCheck(quality, "iqc-request");
  expect(await submitQualityCheck(quality, "iqc-request")).toEqual(first);
  expect(h.state.movements).toHaveLength(1);
});

function failureRow() {
  return { id: "failure", orgId: "org", linkedEntryId: "inward", partyName: "Supplier", invoiceNo: "INV", failQty: "2", deviationRequestedAt: new Date(), movedToInventoryAt: null };
}
it("rolls deviation stock back when the approval marker cannot be saved", async () => {
  h.state.rows.inwardIqcFms = [inwardRow()];
  h.state.rows.failureLog = [failureRow()];
  h.state.fail = "update:failureLog";
  await expect(approveUnderDeviation("failure", { userId: "approver", role: "Doer" })).rejects.toThrow("injected update fault");
  expect(h.state.movements).toEqual([]);
  expect(h.state.rows.failureLog[0].movedToInventoryAt).toBeNull();
});

it.each(["approveIndent", "cancelIndent", "followUp", "requestDeviation", "rejectDeviation"])("admits %s before its authoritative status read", async (action) => {
  h.state.rows.indents[0].status = "Pending";
  h.state.rows.purchaseOrders = [{ id: "po", orgId: "org", vendorId: "vendor", status: "Open", issuedAt: new Date(), gstPercent: "0", followUpDoneAt: null }];
  h.state.rows.failureLog = [{ ...failureRow(), deviationRequestedAt: action === "rejectDeviation" ? new Date() : null }];
  const actions: Record<string, () => Promise<unknown>> = {
    approveIndent: () => approveIndent("indent", "actor"), cancelIndent: () => cancelIndent("indent"), followUp: () => markFollowUpDone("po", "actor", "done"), requestDeviation: () => requestUnderDeviation("failure", "actor"), rejectDeviation: () => rejectUnderDeviation("failure", { userId: "approver", role: "Doer" }),
  };
  await actions[action]();
  expect(h.state.events[0]).toBe("admit");
  expect(h.state.events.filter((event) => event.startsWith("read:")).every((event) => event.endsWith(":true"))).toBe(true);
});

it("rolls PO receipt stock and indent quantity back when PO invoice persistence fails", async () => {
  h.state.rows.indents[0].poId = "po";
  h.state.rows.indents[0].status = "Ordered";
  h.state.rows.purchaseOrders = [{ id: "po", orgId: "org", vendorId: "vendor", status: "Open", issuedAt: new Date(), followUpDoneAt: new Date(), invoiceUrl: "" }];
  h.state.rows.purchaseOrderLines = [{ id: "line", orgId: "org", poId: "po", indentId: "indent", sku: "sku" }];
  h.state.fail = "update:purchaseOrders";
  await expect(receivePurchaseOrderLine("po", "indent", 3, "actor", "invoice")).rejects.toThrow("injected update fault");
  expect(h.state.movements).toEqual([]);
  expect(h.state.rows.indents[0].receivedQty).toBeNull();
});

it("rejects duplicate indent claims within one PO before writing its header", async () => {
  await expect(createPurchaseOrder({ vendorId: "vendor", attachmentUrl: "po.pdf", issuedBy: "actor", lines: [{ indentId: "indent" }, { indentId: "indent" }] })).rejects.toThrow();
  expect(h.state.rows.purchaseOrders ?? []).toEqual([]);
});

it.each(["inward", "indent"])("rolls %s creation/approval back when its required FMS successor fails", async (kind) => {
  h.event.mockRejectedValueOnce(new Error("successor fault"));
  if (kind === "inward") {
    await expect(createInwardEntry({ partyName: "Supplier", invoiceNo: "INV", inwardType: "Other", attachmentUrl: "", remark: "", createdBy: "actor" })).rejects.toThrow("successor fault");
    expect(h.state.rows.inwardIqcFms ?? []).toEqual([]);
  } else {
    h.state.rows.indents[0].status = "Pending";
    await expect(approveIndent("indent", "actor")).rejects.toThrow("successor fault");
    expect(h.state.rows.indents[0].status).toBe("Pending");
  }
});

it("rolls deviation request back when its required approval task fails", async () => {
  h.state.rows.failureLog = [{ ...failureRow(), deviationRequestedAt: null }];
  h.task.mockRejectedValueOnce(new Error("task fault"));
  await expect(requestUnderDeviation("failure", "actor")).rejects.toThrow("task fault");
  expect(h.state.rows.failureLog[0].deviationRequestedAt).toBeNull();
  expect(h.send).not.toHaveBeenCalled();
});

it.each(["foreign-claim", "completed"])("rejects a PO receipt with %s before adding stock", async (kind) => {
  h.state.rows.indents[0].status = "Ordered";
  h.state.rows.indents[0].poId = kind === "foreign-claim" ? "other-po" : "po";
  h.state.rows.purchaseOrders = [{ id: "po", orgId: "org", vendorId: "vendor", status: kind === "completed" ? "Completed" : "Open", issuedAt: new Date(), followUpDoneAt: new Date(), invoiceUrl: "" }];
  h.state.rows.purchaseOrderLines = [{ id: "line", orgId: "org", poId: "po", indentId: "indent", sku: "sku" }];
  await expect(receivePurchaseOrderLine("po", "indent", 3, "actor")).rejects.toThrow();
  expect(h.state.movements).toEqual([]);
});

it.each(["po-receipt", "deviation-approve", "deviation-request", "deviation-reject", "inward-create"])("uses only one outer replay boundary for %s", async (kind) => {
  h.state.rows.indents[0].status = "Ordered";
  h.state.rows.indents[0].poId = "po";
  h.state.rows.purchaseOrders = [{ id: "po", orgId: "org", vendorId: "vendor", status: "Open", issuedAt: new Date(), followUpDoneAt: new Date(), invoiceUrl: "" }];
  h.state.rows.purchaseOrderLines = [{ id: "line", orgId: "org", poId: "po", indentId: "indent", sku: "sku" }];
  h.state.rows.inwardIqcFms = [inwardRow()];
  h.state.rows.failureLog = [{ ...failureRow(), deviationRequestedAt: kind === "deviation-request" ? null : new Date() }];
  const actor = { userId: "approver", role: "Doer" };
  const operations: Record<string, () => Promise<unknown>> = {
    "po-receipt": () => receivePurchaseOrderLine("po", "indent", 3, "actor", undefined, "key"),
    "deviation-approve": () => approveUnderDeviation("failure", actor, "key"),
    "deviation-request": () => requestUnderDeviation("failure", "actor", "key"),
    "deviation-reject": () => rejectUnderDeviation("failure", actor, "key"),
    "inward-create": () => createInwardEntry({ partyName: "Supplier", invoiceNo: "INV", inwardType: "Other", attachmentUrl: "", remark: "", createdBy: "actor" }, "key"),
  };
  const first = await operations[kind]();
  expect(await operations[kind]()).toEqual(first);
  expect(h.mutation).toHaveBeenCalledTimes(2);
  expect(h.state.movements).toHaveLength(kind === "po-receipt" || kind === "deviation-approve" ? 1 : 0);
});

it.each(["iqc", "indent-approval", "po-issue", "deviation"])("rejects non-finite quantity at the %s domain boundary", async (kind) => {
  h.state.rows.inwardIqcFms = [inwardRow()];
  h.state.rows.failureLog = [{ ...failureRow(), failQty: "Infinity" }];
  const operations: Record<string, () => Promise<unknown>> = {
    iqc: () => submitQualityCheck({ ...quality, passQty: Infinity }),
    "indent-approval": () => { h.state.rows.indents[0].status = "Pending"; return approveIndent("indent", "actor", Infinity); },
    "po-issue": () => { h.state.rows.indents[0].finalQty = "Infinity"; return createPurchaseOrder({ vendorId: "vendor", lines: [{ indentId: "indent" }], attachmentUrl: "po.pdf", issuedBy: "actor" }); },
    deviation: () => approveUnderDeviation("failure", { userId: "approver", role: "Doer" }),
  };
  await expect(operations[kind]()).rejects.toThrow();
  expect(h.state.movements).toEqual([]);
});

it("does not let plain indent receiving bypass its PO follow-up gate", async () => {
  h.state.rows.indents[0].status = "Ordered";
  h.state.rows.indents[0].poId = "po";
  h.state.rows.purchaseOrders = [{ id: "po", orgId: "org", status: "Open", followUpDoneAt: null }];
  h.state.rows.purchaseOrderLines = [{ id: "line", orgId: "org", poId: "po", indentId: "indent", sku: "sku" }];
  await expect(receiveIndent("indent", 3, "actor")).rejects.toThrow("PO");
  expect(h.state.movements).toEqual([]);
});

it("does not cancel an indent still claimed by a PO", async () => {
  h.state.rows.indents[0].status = "Ordered";
  h.state.rows.indents[0].poId = "po";
  await expect(cancelIndent("indent")).rejects.toThrow("PO");
  expect(h.state.rows.indents[0].status).toBe("Ordered");
});

it("uploads generated PO documents only after commit and keeps the issue replay DTO stable", async () => {
  h.upload.mockImplementationOnce(async () => {
    expect(h.state.active).toBe(false);
    expect(h.state.rows.purchaseOrders).toHaveLength(1);
    expect(h.state.rows.indents[0].status).toBe("Ordered");
    return { url: "https://example.invalid/generated.pdf" };
  });
  const input = { vendorId: "vendor", lines: [{ indentId: "indent" }], attachmentUrl: "", generateAttachment: true, issuedBy: "actor" };
  const first = await createPurchaseOrder(input, "generated-po");
  expect(await createPurchaseOrder(input, "generated-po")).toEqual(first);
  expect(h.upload).toHaveBeenCalledTimes(1);
  expect(h.state.rows.purchaseOrders[0].attachmentUrl).toBe("https://example.invalid/generated.pdf");
});

it("exposes a committed PO result instead of a retryable issue failure when PDF generation fails", async () => {
  const { POST } = await import("../src/app/api/purchase/orders/route");
  h.mutation.mockRejectedValueOnce(Object.assign(new Error("post-commit PDF failure"), { committed: true, result: { id: "committed-po", attachmentUrl: "" } }));
  const response = await POST(new Request("https://example.invalid/api", { method: "POST", headers: { "Idempotency-Key": "pdf-request" }, body: JSON.stringify({ vendorId: "vendor", lines: [{ indentId: "indent" }], generateAttachment: true }) }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ committed: true, order: { id: "committed-po" }, warning: "post-commit PDF failure" });
});

it("does not persist a deviation request when its configured approver cannot be resolved", async () => {
  const users = await import("../src/lib/auth/users");
  vi.spyOn(users, "getUserById").mockResolvedValueOnce(null);
  h.state.rows.failureLog = [{ ...failureRow(), deviationRequestedAt: null }];
  await expect(requestUnderDeviation("failure", "actor")).rejects.toThrow("Approver");
  expect(h.state.rows.failureLog[0].deviationRequestedAt).toBeNull();
  expect(h.task).not.toHaveBeenCalled();
  expect(h.send).not.toHaveBeenCalled();
});

it("rejects standalone calls to the internal PO stock writer", async () => {
  h.state.rows.indents[0].status = "Ordered";
  h.state.rows.indents[0].poId = "po";
  await expect(receiveIndentForPurchaseOrder("indent", 3, "actor", "po")).rejects.toThrow("transaction");
  expect(h.state.movements).toEqual([]);
});

const apiKinds = ["issue", "indent-receipt", "po-receipt", "iqc", "inward-create", "deviation-request", "deviation-approve", "deviation-reject"];
async function callApi(kind: string): Promise<Response> {
  h.state.rows.indents[0].status = "Ordered"; h.state.rows.indents[0].poId = "po";
  h.state.rows.purchaseOrders = [{ id: "po", orgId: "org", vendorId: "vendor", status: "Open", issuedAt: new Date(), followUpDoneAt: new Date(), invoiceUrl: "" }];
  h.state.rows.purchaseOrderLines = [{ id: "line", orgId: "org", poId: "po", indentId: "indent", sku: "sku" }];
  h.state.rows.inwardIqcFms = [inwardRow()];
  h.state.rows.failureLog = [{ ...failureRow(), deviationRequestedAt: kind === "deviation-request" ? null : new Date() }];
  const ctx = { params: Promise.resolve({ poId: "po", indentId: "indent", entryId: "inward", failureLogId: "failure" }) };
  const req = (body: unknown) => new Request("https://example.invalid/api", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "api-key" }, body: JSON.stringify(body) });
  let response: Response;
  switch (kind) {
    case "issue":
      h.state.rows.indents[0].status = "Approved"; h.state.rows.indents[0].poId = "";
      response = await (await import("../src/app/api/purchase/orders/route")).POST(req({ vendorId: "vendor", lines: [{ indentId: "indent" }], attachmentUrl: "po.pdf", issuedBy: "attacker" })); break;
    case "indent-receipt":
      h.state.rows.indents[0].status = "Approved"; h.state.rows.indents[0].poId = "";
      response = await (await import("../src/app/api/inventory/indents/[indentId]/receive/route")).POST(req({ quantity: "3", userId: "attacker" }), ctx); break;
    case "po-receipt": response = await (await import("../src/app/api/purchase/orders/[poId]/receive/route")).POST(req({ indentId: "indent", quantity: "3", userId: "attacker" }), ctx); break;
    case "iqc": response = await (await import("../src/app/api/inward/[entryId]/quality-check/route")).POST(req({ verifyChecked: true, passQty: "3", failQty: 0, verifiedBy: "attacker" }), ctx); break;
    case "inward-create": response = await (await import("../src/app/api/inward/route")).POST(req({ partyName: "Supplier", invoiceNo: "INV", inwardType: "Other", createdBy: "attacker" })); break;
    case "deviation-request": response = await (await import("../src/app/api/inward/failure-log/[failureLogId]/request-deviation/route")).POST(req({ userId: "attacker" }), ctx); break;
    case "deviation-approve": response = await (await import("../src/app/api/inward/failure-log/[failureLogId]/approve-deviation/route")).POST(req({ userId: "attacker" }), ctx); break;
    default: response = await (await import("../src/app/api/inward/failure-log/[failureLogId]/reject-deviation/route")).POST(req({ userId: "attacker" }), ctx);
  }
  return response;
}

it.each(apiKinds)("forwards parsed input and the trusted actor/key from the %s API", async (kind) => {
  const response = await callApi(kind);
  expect(response.status).toBe(200);
  expect(h.mutation).toHaveBeenCalledTimes(1);
  expect(h.mutation.mock.calls[0][1]).toMatchObject({ actorId: "actor", key: "api-key" });
  expect(JSON.stringify(h.mutation.mock.calls[0][1].payload)).not.toContain("attacker");
});

it.each(apiKinds)("does not report a committed %s result as a retryable API error", async (kind) => {
  h.mutation.mockRejectedValueOnce(Object.assign(new Error("committed cleanup warning"), { committed: true, result: kind.startsWith("deviation") ? null : { id: "saved" } }));
  const response = await callApi(kind);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ committed: true, warning: "committed cleanup warning" });
});

it.each(apiKinds)("returns 409 for a bound-key conflict from the %s API", async (kind) => {
  const { MutationConflictError } = await import("../src/lib/mutations");
  h.mutation.mockRejectedValueOnce(new MutationConflictError());
  expect((await callApi(kind)).status).toBe(409);
});
