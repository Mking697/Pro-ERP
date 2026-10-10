import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db, runInTenantTransaction } from "../src/db/client";
import { organizations, orders, orderItems, orderPayments, orderActivities, journalEntries, journalLines, chartOfAccounts, mutationReceipts, stockLedger, productionPlans, planMaterials, items } from "../src/db/schema";
import { runWithTenant, type TenantContext } from "../src/lib/tenant";
import { recordPayment, runStockCheck, cancelOrder, orderReservedBySku, recheckShortfallForSku } from "../src/lib/orders/orders";
import * as policy from "../src/lib/inventory/availability";

let orgId: string;
let orderId: string;
const actorId = "orders-regression-actor";
function tenant<T>(work: () => Promise<T>) {
  return runWithTenant({ orgId } as TenantContext, work);
}
async function rows() {
  return {
    payments: await db.select().from(orderPayments).where(eq(orderPayments.orgId, orgId)),
    activities: await db.select().from(orderActivities).where(eq(orderActivities.orgId, orgId)),
    journals: await db.select().from(journalEntries).where(eq(journalEntries.orgId, orgId)),
    lines: await db.select().from(journalLines).where(eq(journalLines.orgId, orgId)),
    receipts: await db.select().from(mutationReceipts).where(eq(mutationReceipts.orgId, orgId)),
  };
}
// NOT EXECUTED in the October 9 integration: guarded backend verification required.
async function seedStock(orderIds: string[], quantity = 10) {
  const sku = `orders-stock-${randomUUID()}`;
  await db.insert(items).values({orgId,sku,itemName:"FG regression",category:"FG",uom:"PCS"});
  await db.insert(stockLedger).values({id:`stock-${randomUUID()}`,orgId,sku,direction:"In",quantity:String(quantity),uom:"PCS",source:"Opening"});
  for (const id of orderIds) {
    await db.update(orders).set({status:"Stock_Check"}).where(and(eq(orders.orgId,orgId),eq(orders.id,id)));
    await db.insert(orderItems).values({orgId,orderId:id,lineNo:"1",sku,itemName:"FG regression",uom:"PCS",qty:"6",reservedQty:"0",shortageQty:"6"});
  }
  return sku;
}
it("concurrent same-key replay commits one payment activity journal and receipt", async () => {
  const results = await Promise.all([1,2].map(() => tenant(() => recordPayment(orderId,{amount:10,mode:"Cash"},actorId,"payment-replay"))));
  expect(results[0]).toEqual(results[1]);
  const state = await rows();
  expect(state.payments).toHaveLength(1); expect(state.activities).toHaveLength(1);
  expect(state.journals).toHaveLength(1); expect(state.lines).toHaveLength(2); expect(state.receipts).toHaveLength(1);
  expect(state.journals[0].sourceId).toBe(state.payments[0].id);
});
it("different keys keep equal-valued installments and GL sources distinct", async () => {
  await Promise.all(["first","second"].map((key) => tenant(() => recordPayment(orderId,{amount:10,mode:"Cash"},actorId,key))));
  const state = await rows();
  expect(state.payments).toHaveLength(2); expect(state.activities).toHaveLength(2);
  expect(state.journals).toHaveLength(2); expect(state.lines).toHaveLength(4); expect(state.receipts).toHaveLength(2);
  expect(new Set(state.journals.map((row) => row.sourceId))).toEqual(new Set(state.payments.map((row) => row.id)));
});
it("replay binding conflicts on changed amount or trusted actor", async () => {
  await tenant(() => recordPayment(orderId,{amount:10,mode:"Cash"},actorId,"bound-payment"));
  await expect(tenant(() => recordPayment(orderId,{amount:11,mode:"Cash"},actorId,"bound-payment"))).rejects.toMatchObject({status:409});
  await expect(tenant(() => recordPayment(orderId,{amount:10,mode:"Cash"},"other-actor","bound-payment"))).rejects.toMatchObject({status:409});
  expect((await rows()).payments).toHaveLength(1);
});
it("equivalent parsed payment payload replays despite transport formatting", async () => {
  await tenant(() => recordPayment(orderId,{amount:10.004,mode:"Cash",reference:" ref ",receivedAt:"2026-01-01T05:30:00+05:30"},actorId,"canonical-payment"));
  await tenant(() => recordPayment(orderId,{amount:10,mode:"Cash",reference:"ref",receivedAt:"2026-01-01T00:00:00.000Z"},actorId,"canonical-payment"));
  expect((await rows()).payments).toHaveLength(1);
});
it("internal three-argument CN payment rolls back with its enclosing command", async () => {
  await expect(tenant(() => runInTenantTransaction(orgId,async () => {
    await recordPayment(orderId,{amount:10,mode:"Credit_Note"},actorId);
    throw new Error("outer CN failure");
  }))).rejects.toThrow("outer CN failure");
  expect(await rows()).toEqual({payments:[],activities:[],journals:[],lines:[],receipts:[]});
});
it("competing stock checks cannot reserve more than actual free stock", async () => {
  const secondId = `order-${randomUUID()}`;
  await db.insert(orders).values({id:secondId,orgId,status:"Stock_Check",orderValue:"100"});
  const sku = await seedStock([orderId,secondId]);
  await Promise.all([orderId,secondId].map((id) => tenant(() => runStockCheck(id,actorId))));
  const lines = await db.select().from(orderItems).where(eq(orderItems.orgId,orgId));
  expect(lines.reduce((sum,row) => sum+Number(row.reservedQty),0)).toBe(10);
  expect(lines.reduce((sum,row) => sum+Number(row.shortageQty),0)).toBe(2);
  expect((await tenant(() => policy.getStockAvailability())).free.get(sku)).toBe(0);
});
it("cancellation races stock admission without a phantom commitment", async () => {
  const sku = await seedStock([orderId]);
  const results = await Promise.allSettled([tenant(() => cancelOrder(orderId,"regression",actorId)),tenant(() => runStockCheck(orderId,actorId))]);
  expect(results[0].status).toBe("fulfilled");
  expect((await db.select().from(orders).where(eq(orders.id,orderId)))[0].status).toBe("Cancelled");
  expect((await tenant(() => orderReservedBySku())).get(sku) ?? 0).toBe(0);
  expect((await tenant(() => policy.getStockAvailability())).free.get(sku)).toBe(10);
});
it("concurrent automatic top-ups allocate oldest unmet order first", async () => {
  const secondId = `order-${randomUUID()}`;
  await db.update(orders).set({createdAt:new Date("2026-01-01")}).where(eq(orders.id,orderId));
  await db.insert(orders).values({id:secondId,orgId,status:"Stock_Check",createdAt:new Date("2026-01-02")});
  const sku = await seedStock([orderId,secondId],6);
  await db.update(orders).set({status:"Dispatch_Pending"}).where(eq(orders.orgId,orgId));
  await Promise.all([1,2].map(() => tenant(() => recheckShortfallForSku(sku))));
  const lines = await db.select().from(orderItems).where(eq(orderItems.orgId,orgId));
  expect(Number(lines.find((row) => row.orderId === orderId)!.reservedQty)).toBe(6);
  expect(Number(lines.find((row) => row.orderId === secondId)!.reservedQty)).toBe(0);
});
it.each(["NaN", "-1", "7"])("stock admission rejects corrupt own reservation %s and preserves committed state", async (reservedQty) => {
  await seedStock([orderId]);
  await db.update(orderItems).set({ reservedQty }).where(eq(orderItems.orgId, orgId));
  await expect(tenant(() => runStockCheck(orderId, actorId))).rejects.toThrow(/quantity/i);
  const lines = await db.select().from(orderItems).where(eq(orderItems.orgId, orgId));
  expect(lines[0].reservedQty).toBe(reservedQty);
  expect((await db.select().from(orders).where(eq(orders.id, orderId)))[0].status).toBe("Stock_Check");
  expect((await rows()).activities).toEqual([]);
});

it("corrupt shortage on another SKU rolls an automatic top-up back", async () => {
  const sku = await seedStock([orderId], 6);
  await db.update(orders).set({ status: "Dispatch_Pending" }).where(eq(orders.id, orderId));
  await db.insert(orderItems).values({ orgId, orderId, lineNo: "2", sku: `other-${randomUUID()}`, itemName: "Other FG", uom: "PCS", qty: "1", reservedQty: "0", shortageQty: "NaN" });
  await expect(tenant(() => recheckShortfallForSku(sku))).rejects.toThrow(/quantity/i);
  const lines = await db.select().from(orderItems).where(eq(orderItems.orgId, orgId));
  expect(lines.find((line) => line.lineNo === "1")!.reservedQty).toBe("0");
  expect((await rows()).activities).toEqual([]);
});

it("policy fault rolls stock check back instead of committing optimistic availability", async () => {
  await seedStock([orderId]);
  vi.spyOn(policy,"getStockAvailability").mockRejectedValueOnce(new Error("injected availability fault"));
  await expect(tenant(() => runStockCheck(orderId,actorId))).rejects.toThrow("injected availability fault");
  expect((await db.select().from(orderItems).where(eq(orderItems.orgId,orgId)))[0].reservedQty).toBe("0");
  expect((await db.select().from(orders).where(eq(orders.id,orderId)))[0].status).toBe("Stock_Check");
});

beforeEach(async () => {
  const target = new URL(process.env.DATABASE_URL ?? "");
  if (target.hostname !== "pro-erp-regression-pg" || target.port !== "5432" || target.pathname !== "/pro_erp_test" || target.username !== "pro_erp_test") throw new Error("Guarded disposable Orders target required");
  expect((await db.execute(sql`select current_database() name`)).rows[0].name).toBe("pro_erp_test");
  orgId = `orders-test-${randomUUID()}`;
  orderId = `order-${randomUUID()}`;
  await db.insert(organizations).values({ id: orgId, slug: orgId, orgName: "Orders regression", ownerEmail: "regression@example.invalid", plan: "Enterprise" });
  await db.insert(orders).values({ id: orderId, orgId, status: "Payment_Review", orderValue: "100" });
});
afterEach(async () => {
  vi.restoreAllMocks();
  // Only this test's tenant; no default setup/production target.
  for (const table of [mutationReceipts, journalLines, journalEntries, chartOfAccounts, orderActivities, orderPayments, orderItems, orders, planMaterials, productionPlans, stockLedger, items]) {
    await db.delete(table).where(eq(table.orgId, orgId));
    expect(await db.select().from(table).where(eq(table.orgId, orgId))).toEqual([]);
  }
  await db.delete(organizations).where(eq(organizations.id, orgId));
  expect((await db.select().from(organizations).where(eq(organizations.id, orgId)))).toEqual([]);
});

it("rolls payment and activity back when actual GL insertion fails", async () => {
  const name = `orders_fault_${randomUUID().replaceAll("-", "")}`;
  const fn = sql.identifier(name);
  const trigger = sql.identifier(name);
  try {
    await db.execute(sql`create function ${fn}() returns trigger language plpgsql as ${sql.raw(`$$BEGIN IF NEW.org_id = '${orgId}' THEN RAISE EXCEPTION 'injected GL fault'; END IF; RETURN NEW; END;$$`)}`);
    await db.execute(sql`create trigger ${trigger} before insert on journal_entries for each row execute function ${fn}()`);
    await expect(tenant(() => recordPayment(orderId, { amount: 10, mode: "Cash" }, actorId))).rejects.toThrow();
    expect(await rows()).toEqual({ payments: [], activities: [], journals: [], lines: [], receipts: [] });
  } finally {
    await db.execute(sql`drop trigger if exists ${trigger} on journal_entries`);
    await db.execute(sql`drop function if exists ${fn}()`);
  }
});
