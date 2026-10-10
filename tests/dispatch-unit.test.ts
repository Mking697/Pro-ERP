import { AsyncLocalStorage } from "node:async_hooks";
import { beforeEach, expect, it, vi } from "vitest";
import { getTableColumns, getTableName, SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

// No actual client/tenant/provider module can load in this isolated suite.
const seam = vi.hoisted(() => ({
  db: {} as Record<string, unknown>, transaction: null as unknown,
  available: vi.fn(async () => ({})), event: vi.fn(async () => {}),
}));
vi.mock("@/db/client", () => ({
  db: seam.db,
  runInTenantTransaction: (org: string, work: () => Promise<unknown>) =>
    (seam.transaction as (org: string, work: () => Promise<unknown>) => Promise<unknown>)(org, work),
  afterTenantCommit: async (effect: () => Promise<void>) => { effects.push(effect); },
}));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "org" }));
vi.mock("@/lib/auth/users", () => ({ getUserById: async (id: string) => ({ User_ID: id, Full_Name: id }) }));
vi.mock("@/lib/inventory/items", () => ({ findItem: async () => ({ Location: "" }) }));
vi.mock("@/lib/inventory/availability", () => ({ assertStockAvailableMany: seam.available }));
vi.mock("@/lib/fms/calendar", () => ({ computeTatDeadline: async () => 100000 }));
vi.mock("@/lib/fms/engine", () => ({ emitFmsEvent: seam.event, startFmsInstance: seam.event }));
vi.mock("@/lib/fms/templates", () => ({ listFmsTemplates: async () => [
  { Step_No: "1", Template_ID: "dispatch-flow", Trigger_Event: "ORDER_FULLY_DISPATCHED", Status: "Active" },
  { Step_No: "1", Template_ID: "delivery-flow", Trigger_Event: "ORDER_FULLY_DELIVERED", Status: "Active" },
  { Step_No: "1", Template_ID: "shipment-flow", Trigger_Event: "ORDER_FULLY_SHIPPED", Status: "Active" },
] }));
vi.mock("@/lib/orders/orders", () => ({ getOrder: async (id: string) => {
  const order = rows("orders").find(r => r.id === id && r.orgId === "org");
  return order ? { ...order, items: rows("order_items").filter(r => r.orderId === id).map(r => ({ ...r,
    qty: Number(r.qty), reservedQty: Number(r.reservedQty), consumedQty: Number(r.consumedQty),
  })) } : null;
} }));
import { confirmDispatch, markDispatched, markDelivered } from "@/lib/dispatch/dispatch";
import { planShipment, confirmLoadingDock } from "@/lib/tms/tms";

type Row = Record<string, unknown>;
let store: Record<string, Row[]>;
let effects: (() => Promise<void>)[];
let rejectTable: string;
let requireLock: boolean;
let writeHook: (table: string) => void;
const scope = new AsyncLocalStorage<boolean>();
const dialect = new PgDialect();
const rows = (name: string) => store[name] ?? (store[name] = []);
const snapshot = () => Object.fromEntries(Object.entries(store).map(([k, v]) => [k, v.map(r => ({ ...r }))]));

function matches(condition: SQL | undefined, row: Row): boolean {
  if (!condition) return true;
  const { sql, params } = dialect.sqlToQuery(condition);
  const columns: Record<string, string> = {};
  for (const table of Object.values(schema)) {
    try { for (const [key, col] of Object.entries(getTableColumns(table as never))) columns[(col as { name: string }).name] = key; } catch { /* enums */ }
  }
  // Evaluate the supported persistence predicate subset, not domain admission logic.
  for (const match of sql.matchAll(/"[^"]+"\."([^"]+)" = \$(\d+)/g)) {
    if (row[columns[match[1]]] !== params[Number(match[2]) - 1]) return false;
  }
  for (const match of sql.matchAll(/"[^"]+"\."([^"]+)" in \(([^)]+)\)/g)) {
    const values = [...match[2].matchAll(/\$(\d+)/g)].map(m => params[Number(m[1]) - 1]);
    if (!values.includes(row[columns[match[1]]])) return false;
  }
  if (sql.includes('"consumed_qty" +')) {
    const qty = Number(params.findLast(p => typeof p === "number"));
    if (!(Number(row.consumedQty) >= 0 && Number(row.consumedQty) + qty <= Number(row.reservedQty)
      && Number(row.consumedQty) + qty <= Number(row.qty))) return false;
  }
  return true;
}

function builder(table: unknown, kind: string, selection?: Row) {
  const name = getTableName(table as never);
  let condition: SQL | undefined;
  let values: Row[] = [];
  let changes: Row = {};
  let limit = Infinity;
  const execute = async () => {
    if (requireLock && !scope.getStore()) throw new Error("domain read/write outside tenant lock");
    if (rejectTable === name && kind !== "select") throw new Error(`injected ${name} failure`);
    if (kind === "insert") {
      const created = values.map(v => ({ createdAt: new Date(), tatDeadline: null,
        dispatchedAt: null, deliveredAt: null, loadingDockConfirmedAt: null,
        gatePassAttachmentUrl: "", assignedTo: "", proofOfDispatchUrl: "", podAttachmentUrl: "",
        dispatchId: "", vehiclePrice: "0", transportVendorId: "", ...v }));
      rows(name).push(...created); return created;
    }
    if (kind === "update") writeHook(name);
    const selected = rows(name).filter(r => matches(condition, r)).slice(0, limit);
    if (kind === "update") for (const row of selected) for (const [key, value] of Object.entries(changes)) {
      if (value instanceof SQL) {
        const q = dialect.sqlToQuery(value);
        row[key] = String(Number(row[key]) + Number(q.params[0]));
      } else row[key] = value;
    }
    const projection = selection;
    if (projection) return selected.map(r => Object.fromEntries(Object.entries(projection).map(([key, col]) => [key, r[(col as { key?: string; name: string }).name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())]])));
    return selected;
  };
  const b = {
    where(c: SQL) { condition = c; return b; }, limit(n: number) { limit = n; return b; },
    orderBy() { return b; }, values(v: Row | Row[]) { values = Array.isArray(v) ? v : [v]; return b; },
    set(v: Row) { changes = v; return b; }, returning(s?: Row) { selection = s; return b; },
    execute, then(resolve: (r: Row[]) => unknown, reject: (e: unknown) => unknown) { return execute().then(resolve, reject); },
  };
  return b;
}

beforeEach(() => {
  store = {}; effects = []; rejectTable = ""; requireLock = false; writeHook = () => {};
  seam.available.mockReset(); seam.available.mockResolvedValue({}); seam.event.mockReset();
  let tail: Promise<unknown> = Promise.resolve();
  seam.transaction = async (_org: string, work: () => Promise<unknown>) => {
    if (scope.getStore()) return work();
    const run = tail.then(async () => {
      const before = snapshot(); const prior = effects.length;
      try { const result = await scope.run(true, work); for (const effect of effects.splice(prior)) await effect(); return result; }
      catch (error) { store = before; effects.splice(prior); throw error; }
    });
    tail = run.catch(() => {}); return run;
  };
  Object.assign(seam.db, {
    select: (selection?: Row) => ({ from: (table: unknown) => builder(table, "select", selection) }),
    insert: (table: unknown) => builder(table, "insert"), update: (table: unknown) => builder(table, "update"),
    batch: async (builders: { execute: () => Promise<unknown> }[]) => { const out = []; for (const b of builders) out.push(await b.execute()); return out; },
    transaction: async (work: () => Promise<unknown>) => {
      const before = snapshot(); const prior = effects.length;
      try { return await work(); } catch (error) { store = before; effects.splice(prior); throw error; }
    },
  });
  rows("orders").push({ id: "order", orgId: "org", status: "Ready_For_PDI", transportArrangedBy: "Party", partyName: "Buyer" });
  rows("order_items").push({ orgId: "org", orderId: "order", lineNo: "7", sku: "sku", qty: "10", reservedQty: "10", consumedQty: "0", uom: "PCS", itemName: "Item" });
  rows("pdi_inspections").push({ orgId: "org", orderId: "order", status: "Passed" });
  rows("invoices").push({ orgId: "org", orderId: "order", status: "Draft" }, { orgId: "org", orderId: "order", status: "Issued" });
  shipment("shipment", "4");
});
function shipment(id: string, qty: string, lineNo = "7", sku = "sku") {
  rows("tms_shipments").push({ id, orgId: "org", orderId: "order", status: "At_Loading_Dock", dispatchId: "", createdAt: new Date(), loadingDockConfirmedAt: null });
  rows("tms_shipment_items").push({ orgId: "org", shipmentId: id, lineNo, sku, qty, uom: "PCS", itemName: "Item" });
}
const input = { assignedTo: "user", tatValue: 1, tatUnit: "Minutes" as const };
it("TMS allocation reads and writes stay under the common tenant lock", async () => {
  requireLock = true;
  await expect(planShipment("order", { items: [{ sku: "sku", qty: 6 }] }, "actor")).resolves.toMatchObject({ orderId: "order" });
});

it("TMS splits duplicate-SKU demand over the exact remaining order lines", async () => {
  rows("order_items").push({ ...rows("order_items")[0], lineNo: "9", qty: "5", reservedQty: "5" });
  const planned = await planShipment("order", { items: [{ sku: "sku", qty: 8 }] }, "actor");
  expect(planned.items).toEqual([
    expect.objectContaining({ lineNo: "7", qty: 6 }),
    expect.objectContaining({ lineNo: "9", qty: 2 }),
  ]);
});

it.each([Infinity, 0.0001, 1.0004])("TMS rejects nonfinite or lossy quantity %s before allocation", async qty => {
  await expect(planShipment("order", { items: [{ sku: "sku", qty }] }, "actor")).rejects.toThrow(/quantity|precision/i);
  expect(rows("tms_shipments")).toHaveLength(1);
});

it("Mark Dispatched rolls back its status if activity persistence fails", async () => {
  const dispatch = await confirmDispatch("shipment", input, "actor");
  rejectTable = "dispatch_activities";
  await expect(markDispatched(dispatch.id, {}, { userId: "user", access: [] })).rejects.toThrow(/injected/);
  expect(rows("dispatches")[0].status).toBe("In_Transit");
});

it.each(["Delivered", "Loading_Dock"] as const)("%s transition rolls back on activity failure", async transition => {
  if (transition === "Delivered") {
    const dispatch = await confirmDispatch("shipment", input, "actor");
    rows("dispatches")[0].status = "Dispatched";
    rejectTable = "dispatch_activities";
    await expect(markDelivered(dispatch.id, {}, { userId: "user", access: [] })).rejects.toThrow(/injected/);
    expect(rows("dispatches")[0].status).toBe("Dispatched");
  } else {
    rows("tms_shipments")[0].status = "Pending";
    rejectTable = "tms_activities";
    await expect(confirmLoadingDock("shipment", {}, "actor")).rejects.toThrow(/injected/);
    expect(rows("tms_shipments")[0].status).toBe("Pending");
  }
});

it("required dispatch successor failure rolls back status and permits retry", async () => {
  const dispatch = await confirmDispatch("shipment", input, "actor");
  seam.event.mockRejectedValueOnce(new Error("successor failed"));
  await expect(markDispatched(dispatch.id, {}, { userId: "user", access: [] })).rejects.toThrow("successor failed");
  expect(rows("dispatches")[0].status).toBe("In_Transit");
  await expect(markDispatched(dispatch.id, {}, { userId: "user", access: [] })).resolves.toMatchObject({ status: "Dispatched" });
});

it.each(["Delivered", "Loading_Dock"] as const)("required %s successor failure rolls back lifecycle state", async transition => {
  if (transition === "Delivered") {
    const dispatch = await confirmDispatch("shipment", input, "actor");
    rows("dispatches")[0].status = "Dispatched";
    seam.event.mockRejectedValueOnce(new Error("successor failed"));
    await expect(markDelivered(dispatch.id, {}, { userId: "user", access: [] })).rejects.toThrow("successor failed");
    expect(rows("dispatches")[0].status).toBe("Dispatched");
  } else {
    rows("tms_shipments")[0].status = "Pending";
    rows("tms_shipment_items")[0].qty = "10";
    seam.event.mockRejectedValueOnce(new Error("successor failed"));
    await expect(confirmLoadingDock("shipment", {}, "actor")).rejects.toThrow("successor failed");
    expect(rows("tms_shipments")[0].status).toBe("Pending");
  }
});

it("TMS starts the successor only when the final allocated truck reaches loading dock", async () => {
  rows("tms_shipments")[0].status = "Pending";
  shipment("other", "6"); rows("tms_shipments")[1].status = "Pending";
  await confirmLoadingDock("shipment", {}, "actor");
  expect(seam.event).not.toHaveBeenCalled();
  await confirmLoadingDock("other", {}, "actor");
  expect(seam.event).toHaveBeenCalledTimes(1);
});

it("TMS rejects corrupt persisted allocations instead of treating NaN as zero", async () => {
  rows("tms_shipment_items")[0].qty = "NaN";
  await expect(planShipment("order", { items: [{ sku: "sku", qty: 1 }] }, "actor")).rejects.toThrow(/quantity|nonfinite/i);
  expect(rows("tms_shipments")).toHaveLength(1);
});

it.each(["dispatch_activities", "stock_ledger"])("confirmation rolls back %s failure and replays after retry", async table => {
  rejectTable = table;
  await expect(confirmDispatch("shipment", input, "actor")).rejects.toThrow(/injected/);
  expect(rows("dispatches")).toHaveLength(0);
  expect(rows("order_items")[0].consumedQty).toBe("0");
  expect(rows("tms_shipments")[0].dispatchId).toBe("");
  rejectTable = "";
  const first = await confirmDispatch("shipment", input, "actor");
  const replay = await confirmDispatch("shipment", { ...input, tatValue: 2 }, "another");
  expect(replay.id).toBe(first.id);
  expect(rows("stock_ledger")).toHaveLength(1);
});
it("confirmation replay rejects a conflicting shipment forward pointer", async () => {
  await confirmDispatch("shipment", input, "actor");
  rows("tms_shipments")[0].dispatchId = "different-dispatch";
  await expect(confirmDispatch("shipment", input, "actor")).rejects.toThrow(/reconciliation/i);
  expect(rows("stock_ledger")).toHaveLength(1);
  expect(rows("order_items")[0].consumedQty).toBe("4");
});

it("same-shipment contention returns one effect; distinct shipments increment consumption", async () => {
  const [a, replay] = await Promise.all([confirmDispatch("shipment", input, "actor"), confirmDispatch("shipment", input, "other")]);
  expect(a.id).toBe(replay.id);
  shipment("other", "6");
  await confirmDispatch("other", input, "actor");
  expect(rows("order_items")[0].consumedQty).toBe("10");
  expect(rows("dispatches")).toHaveLength(2);
  expect(rows("stock_ledger")).toHaveLength(2);
});
it.each([["Draft", "Issued"], ["Issued", "Draft"]])("ANY-Issued gate accepts %s then %s", async (a, b) => {
  rows("invoices")[0].status = a; rows("invoices")[1].status = b;
  await expect(confirmDispatch("shipment", input, "actor")).resolves.toMatchObject({ shipmentId: "shipment" });
  expect(seam.available).toHaveBeenCalledWith([{ sku: "sku", quantity: 4 }], { excludeOrderId: "order" });
});
it("foreign or other-order Issued invoices cannot authorize dispatch", async () => {
  rows("invoices")[1].orgId = "foreign";
  rows("invoices").push({ orgId: "org", orderId: "different", status: "Issued" });
  await expect(confirmDispatch("shipment", input, "actor")).rejects.toThrow(/Invoice/);
});
it.each(["lineNo", "sku", "uom"])("exact line guard rejects mismatched %s", async field => {
  rows("tms_shipment_items")[0][field] = "different";
  await expect(confirmDispatch("shipment", input, "actor")).rejects.toThrow(/line/);
});
it("concurrent TMS allocations cannot exceed remaining quantity", async () => {
  const results = await Promise.allSettled([
    planShipment("order", { items: [{ sku: "sku", qty: 4 }] }, "actor"),
    planShipment("order", { items: [{ sku: "sku", qty: 4 }] }, "other"),
  ]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(rows("tms_shipment_items").reduce((sum, r) => sum + Number(r.qty), 0)).toBe(8);
});
it("TMS allocation and activity failure leaves no orphan header or items", async () => {
  rejectTable = "tms_activities";
  await expect(planShipment("order", { items: [{ sku: "sku", qty: 4 }] }, "actor")).rejects.toThrow(/injected/);
  expect(rows("tms_shipments")).toHaveLength(1);
  expect(rows("tms_shipment_items")).toHaveLength(1);
});

it.each(["Cancelled", "Stock_Check"])("TMS rejects shipment allocation for a %s order", async status => {
  rows("orders")[0].status = status;
  await expect(planShipment("order", { items: [{ sku: "sku", qty: 1 }] }, "actor")).rejects.toThrow(/dispatchable/i);
  expect(rows("tms_shipments")).toHaveLength(1);
});

it("TMS rejects historical over-allocation of an exact line even with spare same-SKU capacity", async () => {
  rows("order_items")[0].qty = "3";
  rows("order_items").push({ ...rows("order_items")[0], lineNo: "9", qty: "10", reservedQty: "10" });
  await expect(planShipment("order", { items: [{ sku: "sku", qty: 1 }] }, "actor")).rejects.toThrow(/reconciliation|capacity/i);
  expect(rows("tms_shipments")).toHaveLength(1);
});

it("TMS rejects nonfinite order-line capacity", async () => {
  rows("order_items")[0].qty = "NaN";
  await expect(planShipment("order", { items: [{ sku: "sku", qty: 1 }] }, "actor")).rejects.toThrow(/quantity|nonfinite/i);
});

it("number collision retry rolls back claim and consumption to its savepoint", async () => {
  const originalBatch = seam.db.batch as (builders: { execute: () => Promise<unknown> }[]) => Promise<unknown>;
  let calls = 0;
  seam.db.batch = async (builders: { execute: () => Promise<unknown> }[]) => {
    if (calls++ === 0) throw { cause: { code: "23505", constraint: "dispatches_org_id_gate_pass_no_unique" } };
    return originalBatch(builders);
  };
  await confirmDispatch("shipment", input, "actor");
  expect(calls).toBe(2);
  expect(rows("order_items")[0].consumedQty).toBe("4");
  expect(rows("stock_ledger")).toHaveLength(1);
});

it("rejects a shipment exceeding its exact order-line reservation", async () => {
  rows("order_items")[0].reservedQty = "3";
  await expect(confirmDispatch("shipment", input, "actor")).rejects.toThrow(/reservation|line/i);
  expect(rows("dispatches")).toHaveLength(0);
  expect(rows("stock_ledger")).toHaveLength(0);
  expect(rows("order_items")[0].consumedQty).toBe("0");
});
it("does not overwrite a shipment claim that changed before the guarded write", async () => {
  writeHook = table => { if (table === "tms_shipments") rows(table)[0].dispatchId = "other"; };
  await expect(confirmDispatch("shipment", input, "actor")).rejects.toThrow(/claim/i);
  expect(rows("dispatches")).toHaveLength(0);
  expect(rows("stock_ledger")).toHaveLength(0);
  expect(rows("order_items")[0].consumedQty).toBe("0");
});
