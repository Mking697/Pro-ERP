import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
const boundary = vi.hoisted(() => ({ org: "", recheck: vi.fn(), item: vi.fn(), selectFault: false, materialFaultAt: 0, materialUpdates: 0, finalStateFault: false }));
// Only fault injection is mocked: all normal queries and transactions use real PG.
vi.mock("@/db/client", async (actual) => {
  const real = await actual<typeof import("@/db/client")>();
  const { sql } = await import("drizzle-orm");
  const { planMaterials, fmsRuns } = await import("@/db/schema");
  return { ...real, db: new Proxy(real.db, { get(target, key) {
    if (key === "select" && boundary.selectFault) return () => target.select({ fault: sql`1 / 0` });
    if (key === "update") return (table: unknown) => {
      if (table === planMaterials && ++boundary.materialUpdates === boundary.materialFaultAt) throw new Error("second material write fault");
      if (table === fmsRuns && boundary.finalStateFault) throw new Error("FMS final state fault");
      return target.update(table as Parameters<typeof target.update>[0]);
    };
    return Reflect.get(target, key);
  } }) };
});
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => boundary.org }));
vi.mock("@/lib/orders/orders", () => ({ recheckShortfallForSku: boundary.recheck }));
vi.mock("@/lib/inventory/items", async (actual) => ({ ...await actual<object>(), findItem: boundary.item }));
vi.mock("@/lib/fms/calendar", () => ({ computeNextWorkingInstant: async (_user: string, ms: number) => ms, computeTatDeadline: async (_user: string, ms: number) => ms + 60000, computeUserDayEnd: async () => null }));
vi.mock("@/lib/chatxflow", () => ({ sendWhatsAppMessage: vi.fn() }));
import { db, runInTenantTransaction, isInTenantTransaction } from "@/db/client";
import { organizations, stockLedger, orders, orderItems, productionPlans, planMaterials, fmsRuns, fmsTemplates, mutationReceipts } from "@/db/schema";
import { recordMovement, recordMovementsBulk } from "@/lib/inventory/ledger";
import { startProduction, completePlan, reallocatePlan } from "@/lib/inventory/plans";
import { startFmsInstance, completeFmsStep } from "@/lib/fms/engine";

beforeEach(async () => {
  expect(process.env.DATABASE_URL).toBe("postgresql://pro_erp_test@pro-erp-regression-pg:5432/pro_erp_test?sslmode=disable");
  boundary.org = `stock-workflow-${randomUUID()}`;
  boundary.recheck.mockReset(); boundary.item.mockReset();
  boundary.selectFault = false; boundary.materialFaultAt = 0; boundary.materialUpdates = 0; boundary.finalStateFault = false;
  boundary.item.mockImplementation(async (sku: string) => ({ SKU: sku, UOM: "pcs", Location: "" }));
  await db.insert(organizations).values({ id: boundary.org, orgName: "Disposable stock workflow", slug: boundary.org, ownerEmail: "workflow@example.invalid" });
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const table of [mutationReceipts, fmsRuns, fmsTemplates, planMaterials, productionPlans, orderItems, orders, stockLedger]) {
    await db.delete(table).where(eq(table.orgId, boundary.org));
    expect(await db.select().from(table).where(eq(table.orgId, boundary.org))).toEqual([]);
  }
  await db.delete(organizations).where(eq(organizations.id, boundary.org));
  expect(await db.select().from(organizations).where(eq(organizations.id, boundary.org))).toEqual([]);
});
async function stock(sku = "A", quantity = "10") {
  await db.insert(stockLedger).values({ id: `${boundary.org}-${sku}`, orgId: boundary.org, sku, direction: "In", quantity, source: "Opening" });
}
async function orderHold(quantity = "8") {
  const orderId = `${boundary.org}-order`;
  await db.insert(orders).values({ id: orderId, orgId: boundary.org, status: "Stock_Check" });
  await db.insert(orderItems).values({ orderId, orgId: boundary.org, lineNo: "1", sku: "A", reservedQty: quantity, consumedQty: "0" });
}
const movement = (quantity: number, direction: "In" | "Out" = "Out") => ({ sku: "A", quantity, direction, source: "Manual" as const, uom: "pcs", userId: "test-user" });
async function outs() { return db.select().from(stockLedger).where(and(eq(stockLedger.orgId, boundary.org), eq(stockLedger.direction, "Out"))); }
async function seededPlan(status: "Ready" | "Shortage" | "In_Production" = "Ready", line = "", skus = ["A"]) {
  const id = `${boundary.org}-plan`;
  await db.insert(productionPlans).values({ id, orgId: boundary.org, productName: "Product", productSku: "FG", plannedQty: "6", productionDate: new Date(), status, actualQty: status === "In_Production" ? "6" : null, fmsTemplateId: line });
  await db.insert(planMaterials).values(skus.map((sku) => ({ planId: id, orgId: boundary.org, sku, qtyPerUnit: "1", requiredQty: "6", allocatedQty: status === "Shortage" ? "0" : "6", consumedQty: status === "In_Production" ? "6" : "0", shortageQty: status === "Shortage" ? "6" : "0", uom: "pcs", status: "Allocated" as const })));
  return id;
}
async function seededLine(nextStepMap: Record<string, string> = {}, successor = false) {
  const templateId = `${boundary.org}-line`;
  const base = { templateId, orgId: boundary.org, templateName: "Line", triggerEvent: "MANUAL", stepName: "Step", assignedTo: "test-user", tatValue: "1", tatUnit: "Hours", outcomeOptions: "Done", outcomeType: "DONE" as const };
  await db.insert(fmsTemplates).values({ ...base, stepNo: 1, nextStepMap, actionType: "LEDGER_MOVEMENT", dataSourceType: "FORM", dataSourceConfig: { form: { fields: [{ key: "sku", label: "SKU", type: "text", required: true }, { key: "qty", label: "Quantity", type: "number", required: true }] } }, actionConfig: { Done: { direction: "In", skuField: "sku", qtyField: "qty" } } });
  if (successor) await db.insert(fmsTemplates).values({ ...base, stepNo: 2 });
  return templateId;
}
async function planRows() { return db.select().from(productionPlans).where(eq(productionPlans.orgId, boundary.org)); }
async function materialRows() { return db.select().from(planMaterials).where(eq(planMaterials.orgId, boundary.org)); }
async function runRows() { return db.select().from(fmsRuns).where(eq(fmsRuns.orgId, boundary.org)); }
async function receipts() { return db.select().from(mutationReceipts).where(eq(mutationReceipts.orgId, boundary.org)); }
async function fgRows() { return db.select().from(stockLedger).where(and(eq(stockLedger.orgId, boundary.org), eq(stockLedger.sku, "FG"))); }

// Added integration gates: the parent runs this real-driver shard serially after
// validating its guarded disposable infrastructure. No provider/dotenv fallback.
describe("real PG PPC and FMS committed-state integration", () => {
  it("concurrent keyed production starts issue each material once", async () => {
    await stock(); await stock("B"); const id = await seededPlan("Ready", "", ["A", "B"]);
    const [first, replay] = await Promise.all([startProduction(id, 6, "test-user", "start-key"), startProduction(id, 6, "test-user", "start-key")]);
    expect(replay).toEqual(first); expect(await outs()).toHaveLength(2);
    expect((await materialRows()).map((row) => row.consumedQty)).toEqual(["6", "6"]);
    expect((await planRows())[0].status).toBe("In_Production"); expect(await receipts()).toHaveLength(1);
  });
  it("a later material-state failure rolls back issued stock and the receipt", async () => {
    await stock(); await stock("B"); const id = await seededPlan("Ready", "", ["A", "B"]);
    boundary.materialFaultAt = 2;
    await expect(startProduction(id, 6, "test-user", "retry-start")).rejects.toThrow("second material write fault");
    boundary.materialFaultAt = 0;
    expect(await outs()).toEqual([]); expect(await receipts()).toEqual([]);
    expect((await materialRows()).every((row) => row.consumedQty === "0")).toBe(true);
    expect((await planRows())[0].status).toBe("Ready");
    await startProduction(id, 6, "test-user", "retry-start"); expect(await outs()).toHaveLength(2);
  });
  it("a missing chosen Line rolls back the production transition", async () => {
    await stock(); const id = await seededPlan("Ready", "missing-line");
    await expect(startProduction(id, 6, "test-user", "line-start")).rejects.toThrow(/pehla step/);
    expect(await outs()).toEqual([]); expect(await receipts()).toEqual([]);
    expect((await planRows())[0].status).toBe("Ready"); expect((await materialRows())[0].consumedQty).toBe("0");
  });
  it("reallocation and a competing issue share one finite stock pool", async () => {
    await stock(); const id = await seededPlan("Shortage");
    await Promise.allSettled([reallocatePlan(id), recordMovement(movement(6))]);
    const issued = (await outs()).reduce((sum, row) => sum + Number(row.quantity), 0);
    const held = Number((await materialRows())[0].allocatedQty);
    expect(issued + held).toBeLessThanOrEqual(10); expect(held).toBeGreaterThanOrEqual(4);
  });
  it("concurrent keyed completion creates one FG output", async () => {
    const id = await seededPlan("In_Production");
    const [first, replay] = await Promise.all([completePlan(id, "test-user", "complete-key"), completePlan(id, "test-user", "complete-key")]);
    expect(replay).toEqual(first); expect(await fgRows()).toHaveLength(1);
    expect((await planRows())[0].status).toBe("Completed"); expect(await receipts()).toHaveLength(1);
  });
  it("an active chosen Line remains the sole FG writer", async () => {
    await stock(); const line = await seededLine(); const id = await seededPlan("Ready", line);
    await startProduction(id, 6, "test-user", "start-line");
    const [run] = await runRows(); expect(run.contextRef).toBe(`PRODUCTION_PLANS:${id}`);
    await completePlan(id, "test-user", "finish-plan"); expect(await fgRows()).toEqual([]);
    await completeFmsStep({ runId: run.id, completedBy: "test-user", outcome: "Done", formData: { sku: "FG", qty: "6" } }, "finish-line");
    expect(await fgRows()).toHaveLength(1);
  });
  it("FMS action rollback leaves a pending step and permits the same keyed retry", async () => {
    const line = await seededLine({ Done: "2" }, true);
    const run = await startFmsInstance({ templateId: line, contextRef: "context", startedBy: "test-user" });
    const input = { runId: run.Run_ID, completedBy: "test-user", outcome: "Done", formData: { sku: "FG", qty: "2" } };
    boundary.finalStateFault = true;
    await expect(completeFmsStep(input, "fms-retry")).rejects.toThrow("FMS final state fault");
    boundary.finalStateFault = false;
    expect(await fgRows()).toEqual([]); expect(await receipts()).toEqual([]); expect((await runRows())[0].status).toBe("Pending");
    const [first, replay] = await Promise.all([completeFmsStep(input, "fms-retry"), completeFmsStep(input, "fms-retry")]);
    expect(replay).toEqual(first); expect(await fgRows()).toHaveLength(1); expect(await runRows()).toHaveLength(2); expect(await receipts()).toHaveLength(1);
  });
  it("a missing required FMS successor rolls back the completed action", async () => {
    const line = await seededLine({ Done: "2" });
    const run = await startFmsInstance({ templateId: line, contextRef: "context", startedBy: "test-user" });
    await expect(completeFmsStep({ runId: run.Run_ID, completedBy: "test-user", outcome: "Done", formData: { sku: "FG", qty: "2" } }, "missing-successor")).rejects.toThrow(/successor/);
    expect(await fgRows()).toEqual([]); expect(await receipts()).toEqual([]); expect((await runRows())[0].status).toBe("Pending");
  });
});

describe("real PG ledger authoritative admission", () => {
  it("does not accept legacy caller availability over an Order hold", async () => {
    await stock(); await orderHold();
    await expect(recordMovement(movement(3), 999)).rejects.toThrow(/stock/i);
    expect(await outs()).toEqual([]);
  });
  it("rejects aggregate bulk Outs and keeps bulk In's void result", async () => {
    await stock();
    await expect(recordMovementsBulk([movement(6), movement(6)])).rejects.toThrow(/stock/i);
    expect(await outs()).toEqual([]);
    expect(await recordMovementsBulk([movement(2, "In")])).toBeUndefined();
  });
  it("serializes competing manual Outs", async () => {
    await stock();
    const results = await Promise.allSettled([recordMovement(movement(6)), recordMovement(movement(6))]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await outs()).toHaveLength(1);
  });
  it.each([Infinity, NaN, 0.0001, 1.0004])("rejects invalid In and bulk quantity %s", async (quantity) => {
    await expect(recordMovement(movement(quantity, "In"))).rejects.toThrow(/quantity/i);
    await expect(recordMovementsBulk([movement(quantity, "In")])).rejects.toThrow(/quantity/i);
  });
  it("fails closed on an actual SQL availability fault", async () => {
    await stock();
    boundary.selectFault = true;
    try {
      await expect(recordMovement(movement(1))).rejects.toMatchObject({ cause: { code: "22012" } });
    } finally {
      boundary.selectFault = false;
    }
    expect(await outs()).toEqual([]);
  });
  it("joins a nested tenant transaction and rolls back required successor state with it", async () => {
    await orderHold("0");
    const lines = () => db.select().from(orderItems).where(eq(orderItems.orgId, boundary.org));
    boundary.recheck.mockImplementation(async () => {
      expect(isInTenantTransaction()).toBe(true);
      await db.update(orderItems).set({ reservedQty: "2" }).where(eq(orderItems.orgId, boundary.org));
    });
    await runInTenantTransaction(boundary.org, async () => {
      await recordMovement(movement(2, "In"));
      expect(boundary.recheck).toHaveBeenCalledWith("A");
      expect((await lines())[0].reservedQty).toBe("2");
    });
    await db.update(orderItems).set({ reservedQty: "0" }).where(eq(orderItems.orgId, boundary.org));
    const beforeLines = await lines();
    const beforeLedger = await db.select().from(stockLedger).where(eq(stockLedger.orgId, boundary.org));
    boundary.recheck.mockClear();
    await expect(runInTenantTransaction(boundary.org, async () => {
      await recordMovement(movement(2, "In"));
      expect((await lines())[0].reservedQty).toBe("2");
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect(boundary.recheck).toHaveBeenCalledWith("A");
    expect(await lines()).toEqual(beforeLines);
    expect(await db.select().from(stockLedger).where(eq(stockLedger.orgId, boundary.org))).toEqual(beforeLedger);
  });
});
