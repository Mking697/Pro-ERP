import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations, orders, orderItems, invoices, tmsShipments, tmsShipmentItems, dispatches, dispatchActivities, stockLedger, pdiInspections, tmsActivities } from "@/db/schema";
const tenant = vi.hoisted(() => ({ id: "" }));
const persistence = vi.hoisted(() => ({ batchFault: undefined as undefined | (() => Promise<never>) }));
vi.mock("@/db/client", async importOriginal => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, db: new Proxy(actual.db, {
    get(target, property, receiver) {
      if (property === "batch" && persistence.batchFault) {
        const fault = persistence.batchFault; persistence.batchFault = undefined; return fault;
      }
      return Reflect.get(target, property, receiver);
    },
  }) };
});
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => tenant.id }));
vi.mock("@/lib/inventory/ledger", () => ({
  listLedger: async () => db.select().from(stockLedger).where(eq(stockLedger.orgId, tenant.id)),
  onHandBySku: (rows: { sku: string; direction: string; quantity: string }[]) => {
    const out = new Map<string, number>();
    for (const row of rows) out.set(row.sku, (out.get(row.sku) ?? 0) + Number(row.quantity) * (row.direction === "Out" ? -1 : 1));
    return out;
  },
}));
vi.mock("@/lib/auth/users", () => ({ getUserById: async (id: string) => ({ User_ID: id, Full_Name: "Fixture" }) }));
vi.mock("@/lib/fms/calendar", () => ({ computeTatDeadline: async () => Date.now() + 60000 }));
vi.mock("@/lib/fms/engine", () => ({ emitFmsEvent: vi.fn() }));
// Read-only order DTO seam avoids importing another agent's in-flight domain edits.
// All source data still comes from committed PostgreSQL rows on the scoped client.
vi.mock("@/lib/orders/orders", () => ({ getOrder: async (id: string) => {
  const [row] = await db.select().from(orders).where(eq(orders.id, id));
  if (!row || row.orgId !== tenant.id) return null;
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, id));
  return { ...row, items: items.map(line => ({ ...line, qty: Number(line.qty), reservedQty: Number(line.reservedQty), consumedQty: Number(line.consumedQty) })) };
} }));
import { confirmDispatch } from "@/lib/dispatch/dispatch";
import { planShipment } from "@/lib/tms/tms";
it.each([["Draft", "Issued"], ["Issued", "Draft"]] as const)("invoice ANY Issued accepts insertion order %s then %s", async (first, second) => {
  await seed([first, second]); const id = await shipment(); await expect(confirmDispatch(id, input, "actor")).resolves.toMatchObject({ shipmentId: id });
});
it("stock admission protects another order's holds and rolls back every effect", async () => {
  await seed(); const id = await shipment("6");
  await db.insert(orders).values({ id: `${orderId}-other`, orgId: tenant.id, status: "Stock_Check" });
  await db.insert(orderItems).values({ orderId: `${orderId}-other`, orgId: tenant.id, lineNo: "1", sku, reservedQty: "5" });
  await expect(confirmDispatch(id, input, "actor")).rejects.toThrow();
  expect(await db.select().from(dispatches).where(eq(dispatches.orgId, tenant.id))).toEqual([]);
  expect((await db.select().from(orderItems).where(eq(orderItems.orderId, orderId)))[0].consumedQty).toBe("0");
  expect((await db.select().from(tmsShipments).where(eq(tmsShipments.id, id)))[0].dispatchId).toBe("");
});
it("shipment cannot consume more than its exact order line reservation", async () => {
  await seed(); await db.update(orderItems).set({ reservedQty: "3" }).where(eq(orderItems.orderId, orderId)); const id = await shipment("4");
  await expect(confirmDispatch(id, input, "actor")).rejects.toThrow();
});
it("concurrent distinct shipments sharing a line increment exactly", async () => {
  await seed(); const a = await shipment("4"), b = await shipment("6");
  await Promise.all([confirmDispatch(a, input, "actor"), confirmDispatch(b, input, "actor")]);
  expect((await db.select().from(orderItems).where(eq(orderItems.orderId, orderId)))[0].consumedQty).toBe("10");
});
it("TMS concurrent allocations stay capped at order quantity", async () => {
  await seed();
  const result = await Promise.allSettled([
    planShipment(orderId, { items: [{ sku, qty: 6 }] }, "actor"),
    planShipment(orderId, { items: [{ sku, qty: 6 }] }, "other"),
  ]);
  expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
  const allocations = await db.select().from(tmsShipmentItems).where(eq(tmsShipmentItems.orgId, tenant.id));
  expect(allocations.reduce((sum, r) => sum + Number(r.qty), 0)).toBe(6);
  expect(allocations[0].lineNo).toBe("7");
});
it("TMS plans exact order lines that dispatch can consume", async () => {
  await seed();
  const planned = await planShipment(orderId, { items: [{ sku, qty: 4 }] }, "actor");
  await db.update(tmsShipments).set({ status: "At_Loading_Dock" }).where(eq(tmsShipments.id, planned.id));
  await expect(confirmDispatch(planned.id, input, "actor")).resolves.toMatchObject({ shipmentId: planned.id });
  expect((await db.select().from(orderItems).where(eq(orderItems.orderId, orderId)))[0].consumedQty).toBe("4");
});
it("dispatch fault rolls back consumption and claim; retry and replay stay single", async () => {
  await seed(); const id = await shipment();
  persistence.batchFault = async () => { throw new Error("injected persistence failure"); };
  try { await expect(confirmDispatch(id, input, "actor")).rejects.toThrow("injected persistence failure"); }
  finally { persistence.batchFault = undefined; }
  expect(await db.select().from(dispatches).where(eq(dispatches.orgId, tenant.id))).toHaveLength(0);
  expect(await db.select().from(dispatchActivities).where(eq(dispatchActivities.orgId, tenant.id))).toHaveLength(0);
  expect((await db.select().from(orderItems).where(eq(orderItems.orderId, orderId)))[0].consumedQty).toBe("0");
  expect((await db.select().from(tmsShipments).where(eq(tmsShipments.id, id)))[0].dispatchId).toBe("");
  const first = await confirmDispatch(id, input, "actor");
  expect((await confirmDispatch(id, input, "actor")).id).toBe(first.id);
  expect((await db.select().from(orderItems).where(eq(orderItems.orderId, orderId)))[0].consumedQty).toBe("4");
});
it("real SQL gate-pass collision recovers inside a savepoint", async () => {
  await seed(); const id = await shipment();
  await db.insert(dispatches).values({ id: `${tenant.id}-existing`, orgId: tenant.id, orderId, shipmentId: "historical", gatePassNo: "GP-0001" });
  persistence.batchFault = async () => {
    // A real PostgreSQL 23505 aborts this subtransaction after claim/consumption writes.
    await db.insert(dispatches).values({ id: `${tenant.id}-collision`, orgId: tenant.id, orderId, shipmentId: "collision", gatePassNo: "GP-0001" });
    throw new Error("Expected gate pass uniqueness violation");
  };
  try { await expect(confirmDispatch(id, input, "actor")).resolves.toMatchObject({ gatePassNo: "GP-0002" }); }
  finally { persistence.batchFault = undefined; }
  expect((await db.select().from(orderItems).where(eq(orderItems.orderId, orderId)))[0].consumedQty).toBe("4");
  expect(await db.select().from(dispatches).where(eq(dispatches.orgId, tenant.id))).toHaveLength(2);
});

it.each(["Cancelled", "Stock_Check"] as const)("TMS refuses allocation for %s orders despite historical Passed PDI", async status => {
  await seed();
  await db.update(orders).set({ status }).where(eq(orders.id, orderId));
  await expect(planShipment(orderId, { items: [{ sku, qty: 1 }] }, "actor")).rejects.toThrow(/dispatchable/i);
  expect(await db.select().from(tmsShipments).where(eq(tmsShipments.orgId, tenant.id))).toHaveLength(0);
  expect(await db.select().from(tmsActivities).where(eq(tmsActivities.orgId, tenant.id))).toHaveLength(0);
});

it("historical exact-line over-allocation cannot be hidden by another same-SKU line", async () => {
  await seed(); await shipment("4");
  await db.update(orderItems).set({ qty: "3" }).where(eq(orderItems.orderId, orderId));
  await db.insert(orderItems).values({ orgId: tenant.id, orderId, lineNo: "9", sku, qty: "10", reservedQty: "10", uom: "PCS" });
  await expect(planShipment(orderId, { items: [{ sku, qty: 1 }] }, "actor")).rejects.toThrow(/reconciliation|capacity/i);
  expect(await db.select().from(tmsShipments).where(eq(tmsShipments.orgId, tenant.id))).toHaveLength(1);
  expect(await db.select().from(tmsShipmentItems).where(eq(tmsShipmentItems.orgId, tenant.id))).toHaveLength(1);
});

it("dispatch replay fails closed on conflicting shipment pointer without another stock effect", async () => {
  await seed(); const id = await shipment(); await confirmDispatch(id, input, "actor");
  await db.update(tmsShipments).set({ dispatchId: "conflicting-history" }).where(eq(tmsShipments.id, id));
  await expect(confirmDispatch(id, input, "actor")).rejects.toThrow(/reconciliation/i);
  expect(await db.select().from(dispatches).where(eq(dispatches.orgId, tenant.id))).toHaveLength(1);
  expect((await db.select().from(orderItems).where(eq(orderItems.orderId, orderId)))[0].consumedQty).toBe("4");
  expect((await db.select().from(stockLedger).where(eq(stockLedger.orgId, tenant.id))).filter(row => row.source === "Dispatch")).toHaveLength(1);
});

let orderId: string, sku: string;
async function seed(statuses: ("Draft" | "Issued")[] = ["Issued"], quantity = "10") {
  tenant.id = `dispatch-test-${randomUUID()}`; orderId = `${tenant.id}-order`; sku = `${tenant.id}-sku`;
  await db.insert(organizations).values({ id: tenant.id, orgName: "Disposable", slug: tenant.id, ownerEmail: "fixture@example.invalid" });
  await db.insert(orders).values({ id: orderId, orgId: tenant.id, status: "Ready_For_PDI", transportArrangedBy: "Party" });
  await db.insert(orderItems).values({ orgId: tenant.id, orderId, lineNo: "7", sku, qty: "10", reservedQty: "10", uom: "PCS" });
  await db.insert(stockLedger).values({ id: `${tenant.id}-stock`, orgId: tenant.id, sku, quantity, direction: "In", source: "Opening" });
  await db.insert(pdiInspections).values({ id: `${tenant.id}-pdi`, orgId: tenant.id, orderId, status: "Passed" });
  if (statuses.length) await db.insert(invoices).values(statuses.map((status, i) => ({ id: `${tenant.id}-invoice-${i}`, orgId: tenant.id, orderId, status })));
}
async function shipment(qty = "4", lineNo = "7") {
  const id = `${tenant.id}-${randomUUID()}`;
  await db.insert(tmsShipments).values({ id, orgId: tenant.id, orderId, status: "At_Loading_Dock" });
  await db.insert(tmsShipmentItems).values({ shipmentId: id, orgId: tenant.id, lineNo, sku, qty, uom: "PCS" }); return id;
}
const input = { assignedTo: "fixture-user", tatValue: 1, tatUnit: "Minutes" as const };
afterEach(async () => {
  if (!tenant.id) return;
  for (const table of [dispatchActivities, dispatches, tmsShipmentItems, tmsActivities, tmsShipments, invoices, pdiInspections, orderItems, stockLedger, orders]) await db.delete(table).where(eq(table.orgId, tenant.id));
  await db.delete(organizations).where(eq(organizations.id, tenant.id));
  expect(await db.select().from(organizations).where(eq(organizations.id, tenant.id))).toEqual([]);
});
it("concurrent different requests for one shipment return one committed effect and stable replay", async () => {
  await seed(); const id = await shipment();
  const results = await Promise.all([confirmDispatch(id, input, "actor"), confirmDispatch(id, { ...input, tatValue: 2 }, "other")]);
  expect(results[0].id).toBe(results[1].id);
  expect((await confirmDispatch(id, input, "third")).id).toBe(results[0].id);
  expect(await db.select().from(dispatches).where(eq(dispatches.orgId, tenant.id))).toHaveLength(1);
  expect(await db.select().from(stockLedger).where(eq(stockLedger.source, "Dispatch")).then(rows => rows.filter(r => r.orgId === tenant.id))).toHaveLength(1);
  expect((await db.select().from(orderItems).where(eq(orderItems.orderId, orderId)))[0].consumedQty).toBe("4");
});
