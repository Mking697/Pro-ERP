import { AsyncLocalStorage } from "node:async_hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Only persistence/query construction and external boundaries are replaced. Real ledger,
// availability, allocation, plans, action runner, field validation and FMS engine execute.
type Row = Record<string, unknown>;
type Column = { table: string; field: string };
type Table = { name: string; [key: string]: unknown };
type Predicate = (rows: Record<string, Row>) => boolean;
const state = vi.hoisted(() => {
  const names = ["stockLedger", "orders", "orderItems", "productionPlans", "planMaterials", "fmsRuns", "mutationReceipts", "orderActivities", "pdiActivities"];
  const tables = Object.fromEntries(names.map((name) => [name, new Proxy({ name }, {
    get(target, field) { return field === "name" ? target.name : { table: name, field }; },
  })])) as Record<string, Table>;
  return {
    tables, rows: {} as Record<string, Row[]>, effects: [] as (() => Promise<void>)[],
    fault: "", writeCount: 0, faultAt: 0, reads: [] as string[],
    templates: [] as Row[], boms: [] as Row[], recheck: vi.fn(), send: vi.fn(),
    references: { Product_SKU: "FG", Actual_Qty: "2", UOM: "pcs" },
  };
});
vi.mock("@/db/schema", () => state.tables);
vi.mock("@/db/schema/inventory", () => ({ stockLedger: state.tables.stockLedger }));
vi.mock("@/db/schema/orders", () => ({ orders: state.tables.orders, orderItems: state.tables.orderItems }));
vi.mock("@/db/schema/ppc", () => ({ productionPlans: state.tables.productionPlans, planMaterials: state.tables.planMaterials }));
vi.mock("drizzle-orm", () => {
  const value = (operand: unknown, rows: Record<string, Row>) => typeof operand === "object" && operand !== null && "table" in operand
    ? rows[(operand as Column).table]?.[(operand as Column).field] : operand;
  return {
    sql: (_strings: TemplateStringsArray, json: string) => JSON.parse(json),
    eq: (a: unknown, b: unknown) => (rows: Record<string, Row>) => value(a, rows) === value(b, rows),
    and: (...predicates: Predicate[]) => (rows: Record<string, Row>) => predicates.every((p) => p(rows)),
    inArray: (a: unknown, b: unknown[]) => (rows: Record<string, Row>) => b.includes(value(a, rows)),
  };
});
vi.mock("@/db/client", async () => {
  const { AsyncLocalStorage: Storage } = await import("node:async_hooks");
  const active = new Storage<boolean>();
  let queue = Promise.resolve();
  const fault = (operation: string, table: Table) => {
    if (state.fault === `${operation}:${table.name}` || (state.faultAt && ++state.writeCount === state.faultAt)) {
      throw new Error(`injected ${operation}:${table.name}`);
    }
  };
  const insert = (table: Table, values: Row | Row[]) => {
    fault("insert", table);
    const rows = (Array.isArray(values) ? values : [values]).map((row) => ({ timestamp: new Date(), ...row }));
    state.rows[table.name].push(...rows);
    return rows;
  };
  const update = (table: Table, fields: Row, predicate: Predicate) => {
    fault("update", table);
    return state.rows[table.name].filter((row) => predicate({ [table.name]: row })).map((row) => Object.assign(row, fields));
  };
  const db = {
    select(projection?: Record<string, Column>) {
      let table: Table;
      let join: Table | undefined;
      let joinCondition: Predicate;
      let predicate: Predicate = () => true;
      let limit = Infinity;
      const query = {
        from(t: Table) { table = t; return query; },
        innerJoin(t: Table, p: Predicate) { join = t; joinCondition = p; return query; },
        where(p: Predicate) { predicate = p; return query; },
        limit(n: number) { limit = n; return query; },
        catch(reject: (error: unknown) => unknown): Promise<unknown> { return Promise.resolve(query).catch(reject); },
        async then(resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) {
          try {
            state.reads.push(table.name);
            if (state.fault === `select:${table.name}` || (join && state.fault === `select:${join.name}`)) throw new Error(`injected ${state.fault}`);
            const joinedTable = join;
            const contexts = state.rows[table.name].flatMap((row) => joinedTable
              ? state.rows[joinedTable.name].map((other) => ({ [table.name]: row, [joinedTable.name]: other })).filter(joinCondition)
              : [{ [table.name]: row }]);
            const result = contexts.filter(predicate).slice(0, limit).map((rows) => projection
              ? Object.fromEntries(Object.entries(projection).map(([name, column]) => [name, rows[column.table][column.field]]))
              : rows[table.name]);
            return resolve(result);
          } catch (error) { return reject(error); }
        },
      };
      return query;
    },
    insert: (table: Table) => ({ values: async (values: Row | Row[]) => insert(table, values) }),
    update: (table: Table) => ({ set: (fields: Row) => ({ where: async (predicate: Predicate) => update(table, fields, predicate) }) }),
  };
  return {
    db,
    isInTenantTransaction: () => Boolean(active.getStore()),
    insert, update,
    async runInTenantTransaction<T>(_org: string, work: () => Promise<T>): Promise<T> {
      if (active.getStore()) return work();
      const previous = queue;
      let release!: () => void;
      queue = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      const snapshot = structuredClone(state.rows);
      state.effects = [];
      let result: T;
      try { result = await active.run(true, work); }
      catch (error) { state.rows = snapshot; state.effects = []; throw error; }
      finally { release(); }
      const effects = state.effects.splice(0);
      for (const effect of effects) await effect();
      return result;
    },
    async afterTenantCommit(effect: () => Promise<void>) {
      if (active.getStore()) state.effects.push(effect); else await effect();
    },
  };
});
vi.mock("@/db/repo", async () => {
  const client = await import("@/db/client") as unknown as {
    insert: (t: Table, values: Row) => Row[];
    update: (t: Table, fields: Row, predicate: Predicate) => Row[];
  };
  return {
    listByOrg: async (table: Table, org: string) => {
      if (state.fault === `select:${table.name}`) throw new Error(`injected select:${table.name}`);
      return state.rows[table.name].filter((row) => row.orgId === org);
    },
    findById: async (table: Table, org: string, id: string) => state.rows[table.name].find((row) => row.orgId === org && row.id === id),
    insertRecord: async (table: Table, values: Row) => client.insert(table, values)[0],
    updateById: async (table: Table, org: string, id: string, fields: Row) => client.update(table, fields, (rows) => rows[table.name].orgId === org && rows[table.name].id === id)[0],
  };
});
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "org" }));
vi.mock("@/lib/auth/guard", () => ({
  requireModule: async () => ({ ok: true, session: { userId: "user", email: "user", access: ["FMS_ADMIN"] } }),
  requireSession: async () => ({ ok: true, session: { userId: "user", email: "user", access: ["FMS_ADMIN"] } }),
}));
vi.mock("@/lib/orders/orders", () => ({ recheckShortfallForSku: state.recheck }));
vi.mock("@/lib/inventory/items", () => ({
  num: (value: string | null) => value === null || value === "" ? null : Number(value),
  numOr0: (value: unknown) => Number(value) || 0,
  findItem: async (sku: string) => ({ SKU: sku, UOM: "pcs", Location: "" }),
}));
vi.mock("@/lib/inventory/bom", () => ({ listBoms: async () => state.boms }));
vi.mock("@/lib/fms/templates", () => ({
  getFmsTemplateStep: async (id: string, step: number) => state.templates.find((s) => s.Template_ID === id && Number(s.Step_No) === step),
  listFmsTemplates: async () => state.templates,
  parseNextStepMap: (raw: string) => JSON.parse(raw || "{}"),
  parseOutcomeOptions: (raw: string) => raw.split(","),
}));
vi.mock("@/lib/fms/dataSourceResolver", () => ({ resolveExistingFmsData: async () => [state.references] }));
vi.mock("@/lib/fms/calendar", () => ({
  computeNextWorkingInstant: async (_user: string, ms: number) => ms,
  computeTatDeadline: async (_user: string, ms: number) => ms + 60000,
  computeUserDayEnd: async () => null,
}));
vi.mock("@/lib/auth/users", () => ({ getUserById: async () => ({ Full_Name: "Doer", Phone_Number: "test-phone" }) }));
vi.mock("@/lib/chatxflow", () => ({ sendWhatsAppMessage: state.send }));

import { recordMovement, recordMovementsBulk } from "@/lib/inventory/ledger";
import { committedBySku, createPlans, reallocatePlan, cancelPlan, startProduction, completePlan } from "@/lib/inventory/plans";
import { completeFmsStep, startFmsInstance, emitFmsEvent } from "@/lib/fms/engine";
import { runInTenantTransaction, isInTenantTransaction, afterTenantCommit } from "@/db/client";
void AsyncLocalStorage;
void createPlans; void reallocatePlan; void cancelPlan; void startProduction; void completePlan;
void completeFmsStep; void startFmsInstance; void emitFmsEvent; void runInTenantTransaction; void recordMovementsBulk;

beforeEach(() => {
  state.rows = Object.fromEntries(Object.keys(state.tables).map((name) => [name, []]));
  state.effects = []; state.fault = ""; state.writeCount = 0; state.faultAt = 0;
  state.templates = []; state.boms = []; state.reads = [];
  state.recheck.mockReset(); state.send.mockReset(); state.send.mockResolvedValue({ ok: true });
});
const movement = (quantity: number, direction: "In" | "Out" = "Out") => ({ sku: "A", quantity, direction, source: "Manual" as const, uom: "pcs", userId: "user" });
function opening(sku = "A", quantity = "10") {
  state.rows.stockLedger.push({ id: `opening-${sku}`, orgId: "org", sku, quantity, direction: "In", timestamp: new Date() });
}
function orderHold(quantity = "8") {
  state.rows.orders.push({ id: "order", orgId: "org", status: "Stock_Check" });
  state.rows.orderItems.push({ orderId: "order", orgId: "org", sku: "A", reservedQty: quantity, consumedQty: "0" });
}
function bom() {
  state.boms.push({ bomId: "bom", version: 1, status: "Active", productName: "Product", productSku: "FG",
    lines: [{ componentSku: "A", componentName: "A", uom: "pcs", qtyPerUnit: 1 }] });
}
function plan(status = "Ready", line = "") {
  state.rows.productionPlans.push({ id: "plan", orgId: "org", timestamp: new Date(), productName: "Product", productSku: "FG", bomId: "bom", bomVersion: "1", plannedQty: "6", productionDate: new Date(), status,
    actualQty: status === "In_Production" ? "6" : null, startedBy: "", startedAt: null, createdBy: "user", notes: "", jobNo: "job", orderNo: "", fmsTemplateId: line });
  state.rows.planMaterials.push({ planId: "plan", orgId: "org", sku: "A", itemName: "A", qtyPerUnit: "1", requiredQty: "6", allocatedQty: "6", shortageQty: "0", consumedQty: status === "In_Production" ? "6" : "0", uom: "pcs", status: "Allocated" });
}

function step(templateId = "line", stepNo = "1") {
  const definition = { Template_ID: templateId, Template_Name: "Line", Step_No: stepNo, Step_Name: "Step", Assigned_To: "user", TAT_Value: "1", TAT_Unit: "Hours", Outcome_Type: "DONE", Outcome_Options: "Done", Next_Step_Map: "{}", Notify_On_Complete: [], Status: "Active", Trigger_Event: "MANUAL",
    Data_Source_Config: JSON.stringify({ existing: { sourceModule: "PRODUCTION_PLANS", columns: ["Product_SKU", "Actual_Qty", "UOM"], filterByContext: true } }),
    Action_Type: "LEDGER_MOVEMENT", Action_Config: JSON.stringify({ Done: { direction: "In", skuField: "Product_SKU", qtyField: "Actual_Qty" } }) };
  state.templates.push(definition);
  return definition;
}
function pendingRun() {
  state.rows.fmsRuns.push({ id: "run", orgId: "org", instanceId: "instance", templateId: "line", templateName: "Line", contextRef: "PRODUCTION_PLANS:plan", startedBy: "user", startedAt: new Date(), stepNo: 1, stepName: "Step", assignedTo: "user", createdAt: new Date(), tatStart: null, tatDeadline: null, completedAt: null, completedBy: "", outcome: "", status: "Pending", remark: "", formData: null, quantity: "2" });
}
const completion = () => completeFmsStep({ runId: "run", completedBy: "user", outcome: "Done" });

// Modeled required DB successors: rollback assertions inspect state, not invocation.
// The new real-PG shard independently exercises actual Orders and PDI implementations.
function stockSuccessors() {
  state.rows.orderItems.push({ orgId: "org", orderId: "waiting", sku: "FG", reservedQty: "0", shortageQty: "2" });
  state.recheck.mockImplementation(async () => {
    expect(isInTenantTransaction()).toBe(true);
    Object.assign(state.rows.orderItems[0], { reservedQty: "2", shortageQty: "0" });
    state.rows.orderActivities.push({ orderId: "waiting", kind: "Stock_Reserved" });
    state.rows.pdiActivities.push({ pdiId: "waiting-pdi", kind: "Stock_Available" });
    await afterTenantCommit(async () => { await state.send(); });
  });
  return structuredClone(state.rows.orderItems);
}
function expectSuccessorsRolledBack(lines: Row[]) {
  expect(state.rows.orderItems).toEqual(lines);
  expect(state.rows.orderActivities).toEqual([]);
  expect(state.rows.pdiActivities).toEqual([]);
  expect(state.send).not.toHaveBeenCalled();
}

describe("stock workflow DB-free integration", () => {
  it("bulk rechecks each received SKU once inside the outer transaction", async () => {
    state.recheck.mockImplementation(async () => { expect(isInTenantTransaction()).toBe(true); });
    await runInTenantTransaction("org", async () => {
      await recordMovementsBulk([
        movement(1, "In"), movement(2, "In"),
        { ...movement(3, "In"), sku: "B" },
        { ...movement(1, "In"), sku: "" },
      ]);
      expect(state.recheck.mock.calls).toEqual([["A"], ["B"]]);
      expect(state.rows.stockLedger).toHaveLength(4);
    });
    expect(state.recheck).toHaveBeenCalledTimes(2);
  });
  it("persists the same canonical three-decimal quantity that admission validates", async () => {
    await recordMovement(movement(0.1 + 0.2, "In"));
    expect(state.rows.stockLedger[0].quantity).toBe("0.3");
  });
  it("allocates new PPC reservations from authoritative stock including Order holds", async () => {
    opening(); orderHold(); bom();
    const [created] = await createPlans([{ productName: "Product", plannedQty: 6, productionDate: "2026-10-10" }], "user");
    expect(created.materials[0].allocatedQty).toBe(2);
    expect(created.materials[0].shortageQty).toBe(4);
    expect(state.rows.planMaterials[0].allocatedQty).toBe("2");
  });
  it("rolls back material reservations when plan header insertion fails", async () => {
    opening(); bom(); state.fault = "insert:productionPlans";
    await expect(createPlans([{ productName: "Product", plannedQty: 6, productionDate: "2026-10-10" }], "user")).rejects.toThrow("injected");
    expect(state.rows.planMaterials).toEqual([]);
    expect(state.rows.productionPlans).toEqual([]);
  });
  it("consumes only the verified plan's own reservation and releases its remaining hold", async () => {
    opening(); plan();
    const started = await startProduction("plan", 6, "user");
    expect(started.status).toBe("In_Production");
    expect(state.rows.stockLedger.filter((r) => r.direction === "Out")).toHaveLength(1);
    expect(state.rows.planMaterials[0]).toMatchObject({ allocatedQty: "6", consumedQty: "6" });
  });
  it("rolls back every material issue when the plan's final state write fails", async () => {
    opening(); plan(); state.fault = "update:productionPlans";
    await expect(startProduction("plan", 6, "user")).rejects.toThrow("injected");
    expect(state.rows.stockLedger.filter((r) => r.direction === "Out")).toEqual([]);
    expect(state.rows.planMaterials[0].consumedQty).toBe("0");
    expect(state.rows.productionPlans[0].status).toBe("Ready");
  });
  it("admits the aggregate production material batch before its first movement", async () => {
    opening(); plan();
    state.rows.planMaterials[0].allocatedQty = "0";
    state.rows.planMaterials.push({ ...state.rows.planMaterials[0] });
    state.fault = "insert:stockLedger";
    await expect(startProduction("plan", 6, "user")).rejects.toThrow(/Insufficient stock/);
  });
  it("rolls back production when its chosen FMS Line cannot start", async () => {
    opening(); plan("Ready", "missing-line");
    await expect(startProduction("plan", 6, "user")).rejects.toThrow(/pehla step/);
    expect(state.rows.stockLedger.filter((r) => r.direction === "Out")).toEqual([]);
    expect(state.rows.productionPlans[0].status).toBe("Ready");
  });
  it("rolls back FG output when completion state fails", async () => {
    const lines = stockSuccessors();
    plan("In_Production"); state.fault = "update:productionPlans";
    await expect(completePlan("plan", "user")).rejects.toThrow("injected");
    expect(state.rows.stockLedger).toEqual([]);
    expect(state.rows.productionPlans[0].status).toBe("In_Production");
    expect(state.recheck).toHaveBeenCalledWith("FG");
    expectSuccessorsRolledBack(lines);
  });
  it("tops up PPC shortages without spending Order reservations", async () => {
    opening(); orderHold(); plan("Shortage");
    Object.assign(state.rows.planMaterials[0], { allocatedQty: "0", shortageQty: "6" });
    const rechecked = await reallocatePlan("plan");
    expect(rechecked.materials[0]).toMatchObject({ allocatedQty: 2, shortageQty: 4 });
  });
  it("rolls back shortage top-ups when the Ready transition fails", async () => {
    opening(); plan("Shortage");
    Object.assign(state.rows.planMaterials[0], { allocatedQty: "0", shortageQty: "6" });
    state.fault = "update:productionPlans";
    await expect(reallocatePlan("plan")).rejects.toThrow("injected");
    expect(state.rows.planMaterials[0]).toMatchObject({ allocatedQty: "0", shortageQty: "6" });
  });
  it("cancellation waits for admission and cannot cancel a newly started plan", async () => {
    plan();
    let admitted!: () => void; let release!: () => void;
    const ready = new Promise<void>((resolve) => { admitted = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const starting = runInTenantTransaction("org", async () => {
      admitted(); await hold; state.rows.productionPlans[0].status = "In_Production";
    });
    await ready;
    const cancelling = Promise.allSettled([cancelPlan("plan")]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    release(); await starting;
    const [result] = await cancelling;
    expect(result.status).toBe("rejected");
    expect(state.rows.productionPlans[0].status).toBe("In_Production");
  });
  it("rolls back an FMS stock action when its step state fails", async () => {
    const lines = stockSuccessors();
    step(); pendingRun(); state.fault = "update:fmsRuns";
    await expect(completion()).rejects.toThrow("injected");
    expect(state.rows.stockLedger).toEqual([]);
    expect(state.rows.fmsRuns[0].status).toBe("Pending");
    expect(state.recheck).toHaveBeenCalledWith("FG");
    expectSuccessorsRolledBack(lines);
  });
  it("rejects a missing required successor instead of losing completed work", async () => {
    step().Next_Step_Map = JSON.stringify({ Done: "2" }); pendingRun();
    await expect(completion()).rejects.toThrow(/successor/i);
    expect(state.rows.stockLedger).toEqual([]);
    expect(state.rows.fmsRuns[0].status).toBe("Pending");
  });
  it("rolls back action, completion and earlier chained flows when a chained start fails", async () => {
    step(); pendingRun();
    step("chain-a").Trigger_Event = "FMS:line:1:Done";
    step("chain-b").Trigger_Event = "FMS:line:1:Done";
    state.faultAt = 4;
    await expect(completion()).rejects.toThrow("injected insert:fmsRuns");
    expect(state.rows.stockLedger).toEqual([]);
    expect(state.rows.fmsRuns).toHaveLength(1);
    expect(state.rows.fmsRuns[0].status).toBe("Pending");
  });
  it("defers WhatsApp completion sends until the outer commit", async () => {
    const definition = step(); definition.Notify_On_Complete = ["user"] as never[]; pendingRun();
    await runInTenantTransaction("org", async () => {
      await completion();
      expect(state.send).not.toHaveBeenCalled();
    });
    expect(state.send).toHaveBeenCalledTimes(1);
  });
  it("standalone event emission rolls back earlier starts if a later start fails", async () => {
    step("a").Trigger_Event = "EVENT"; step("b").Trigger_Event = "EVENT";
    state.faultAt = 2;
    await expect(emitFmsEvent("EVENT", "context")).rejects.toThrow("injected");
    expect(state.rows.fmsRuns).toEqual([]);
  });
  it("serializes concurrent manual FMS starts when assigning the TAT queue", async () => {
    step();
    const input = { templateId: "line", contextRef: "context", startedBy: "user" };
    const [first, second] = await Promise.all([startFmsInstance(input), startFmsInstance(input)]);
    expect(new Date(second.TAT_Start).getTime()).toBeGreaterThanOrEqual(new Date(first.TAT_Deadline).getTime());
  });
  it("propagates reservation read failures instead of advertising empty PPC commitments", async () => {
    plan(); state.fault = "select:productionPlans";
    await expect(committedBySku()).rejects.toThrow("injected");
  });
  it("refuses an FMS movement whose configured UOM differs from the SKU's unit", async () => {
    const definition = step(); pendingRun();
    definition.Action_Config = JSON.stringify({ Done: { direction: "In", skuField: "Product_SKU", qtyField: "Actual_Qty", uomField: "UOM" } });
    state.references.UOM = "kg";
    await expect(completion()).rejects.toThrow(/UOM/);
    expect(state.rows.stockLedger).toEqual([]);
    state.references.UOM = "pcs";
  });
  it("replays a keyed production start without repeating material consumption", async () => {
    opening(); plan();
    const first = await startProduction("plan", 6, "user", "start-key");
    const replay = await startProduction("plan", 6, "user", "start-key");
    expect(replay).toEqual(first);
    expect(state.rows.stockLedger.filter((r) => r.direction === "Out")).toHaveLength(1);
  });
  it("replays a keyed plan completion without producing FG twice", async () => {
    plan("In_Production");
    const first = await completePlan("plan", "user", "complete-key");
    expect(await completePlan("plan", "user", "complete-key")).toEqual(first);
    expect(state.rows.stockLedger).toHaveLength(1);
  });
  it("replays keyed FMS completion including successors without repeating its stock action", async () => {
    step().Next_Step_Map = JSON.stringify({ Done: "2" }); step("line", "2"); pendingRun();
    const input = { runId: "run", completedBy: "user", outcome: "Done" };
    const first = await completeFmsStep(input, "fms-key");
    expect(await completeFmsStep(input, "fms-key")).toEqual(first);
    expect(state.rows.stockLedger).toHaveLength(1);
    expect(state.rows.fmsRuns).toHaveLength(2);
  });
  it("replays keyed plan creation without creating new reservations", async () => {
    opening(); bom();
    const lines = [{ productName: "Product", plannedQty: 6, productionDate: "2026-10-10" }];
    const first = await createPlans(lines, "user", "create-key");
    expect(await createPlans(lines, "user", "create-key")).toEqual(first);
    expect(state.rows.productionPlans).toHaveLength(1);
    expect(state.rows.planMaterials).toHaveLength(1);
  });
  it("replays keyed manual FMS starts while different keys create distinct instances", async () => {
    step();
    const input = { templateId: "line", contextRef: "context", startedBy: "user" };
    const first = await startFmsInstance(input, "instance-key");
    expect(await startFmsInstance(input, "instance-key")).toEqual(first);
    expect(state.rows.fmsRuns).toHaveLength(1);
    expect((await startFmsInstance(input, "other-key")).Instance_ID).not.toBe(first.Instance_ID);
  });
  it.each(["stock", "plan-create", "plan-start", "plan-complete", "fms-start", "fms-complete"])("HTTP %s returns 409 for a reused key with conflicting intent", async (kind) => {
    opening(); bom(); plan(kind === "plan-complete" ? "In_Production" : "Ready"); step(); pendingRun();
    await startFmsInstance({ templateId: "line", contextRef: "seed", startedBy: "user" }, "conflict-key");
    let invoke: (request: Request) => Promise<Response>;
    let body: Record<string, unknown>;
    if (kind === "stock") {
      invoke = (await import("@/app/api/inventory/movements/route")).POST;
      body = { sku: "A", direction: "In", quantity: 2 };
    } else if (kind === "plan-create") {
      invoke = (await import("@/app/api/ppc/plans/route")).POST;
      body = { lines: [{ productName: "Product", plannedQty: 6, productionDate: "2026-10-10" }] };
    } else if (kind === "plan-start" || kind === "plan-complete") {
      const { PATCH } = await import("@/app/api/ppc/plans/[planId]/route");
      invoke = (request) => PATCH(request, { params: Promise.resolve({ planId: "plan" }) });
      body = kind === "plan-start" ? { action: "start", actualQty: 6 } : { action: "complete" };
    } else if (kind === "fms-start") {
      invoke = (await import("@/app/api/fms/instances/route")).POST;
      body = { templateId: "line", contextRef: "context" };
    } else {
      const { POST } = await import("@/app/api/fms/steps/[runId]/complete/route");
      invoke = (request) => POST(request, { params: Promise.resolve({ runId: "run" }) });
      body = { outcome: "Done" };
    }
    const before = structuredClone(state.rows);
    const response = await invoke(new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "conflict-key" }, body: JSON.stringify(body) }));
    expect(response.status).toBe(409);
    expect(state.rows).toEqual(before);
  });
  it("manual stock HTTP rejects held stock despite body availability and exclusions", async () => {
    const { POST } = await import("@/app/api/inventory/movements/route"); opening(); orderHold();
    const response = await POST(new Request("http://localhost/api/inventory/movements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sku: "A", direction: "Out", quantity: 3, available: 999, excludeOrderId: "order" }) }));
    expect(response.status).toBe(409); expect(state.rows.stockLedger).toHaveLength(1);
  });
  it("manual stock HTTP replay records one movement", async () => {
    const { POST } = await import("@/app/api/inventory/movements/route");
    const request = () => new Request("http://localhost/api/inventory/movements", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "api-movement" }, body: JSON.stringify({ sku: "A", direction: "In", quantity: 2, available: 999, excludeOrderId: "foreign" }) });
    const first = await POST(request()); const replay = await POST(request());
    expect(first.status).toBe(200); expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json()); expect(state.rows.stockLedger).toHaveLength(1);
  });
  it("FMS HTTP manual start replays one instance", async () => {
    const { POST } = await import("@/app/api/fms/instances/route"); step();
    const request = () => new Request("http://localhost/api/fms/instances", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "api-instance" }, body: JSON.stringify({ templateId: "line", contextRef: "context" }) });
    const first = await POST(request()); const replay = await POST(request());
    expect(first.status).toBe(200); expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json()); expect(state.rows.fmsRuns).toHaveLength(1);
  });
  it("FMS HTTP completion replays action and successor state", async () => {
    const { POST } = await import("@/app/api/fms/steps/[runId]/complete/route");
    step().Next_Step_Map = JSON.stringify({ Done: "2" }); step("line", "2"); pendingRun();
    const request = () => new Request("http://localhost/api/fms/steps/run/complete", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "api-fms-complete" }, body: JSON.stringify({ outcome: "Done" }) });
    const first = await POST(request(), { params: Promise.resolve({ runId: "run" }) });
    const replay = await POST(request(), { params: Promise.resolve({ runId: "run" }) });
    expect(first.status).toBe(200); expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    expect(state.rows.stockLedger).toHaveLength(1); expect(state.rows.fmsRuns).toHaveLength(2);
  });
  it("PPC HTTP creation replays the parsed reservation batch", async () => {
    const { POST } = await import("@/app/api/ppc/plans/route");
    opening(); bom();
    const request = () => new Request("http://localhost/api/ppc/plans", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": "api-create" }, body: JSON.stringify({ lines: [{ productName: "Product", plannedQty: 6, productionDate: "2026-10-10" }] }) });
    const first = await POST(request()); const replay = await POST(request());
    expect(first.status).toBe(200); expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    expect(state.rows.productionPlans).toHaveLength(1);
    expect(state.rows.planMaterials).toHaveLength(1);
  });
  it("PPC HTTP completion replays without writing FG twice", async () => {
    const { PATCH } = await import("@/app/api/ppc/plans/[planId]/route");
    plan("In_Production");
    const request = () => new Request("http://localhost/api/ppc/plans/plan", { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": "api-complete" }, body: JSON.stringify({ action: "complete" }) });
    const first = await PATCH(request(), { params: Promise.resolve({ planId: "plan" }) });
    const replay = await PATCH(request(), { params: Promise.resolve({ planId: "plan" }) });
    expect(first.status).toBe(200); expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    expect(state.rows.stockLedger).toHaveLength(1);
  });
  it("PPC HTTP start forwards only the request key and parsed input, never body exclusions", async () => {
    const { PATCH } = await import("@/app/api/ppc/plans/[planId]/route");
    opening(); plan();
    const request = () => new Request("http://localhost/api/ppc/plans/plan", { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": "api-start" }, body: JSON.stringify({ action: "start", actualQty: 6, excludeOrderId: "foreign", excludePlanId: "foreign" }) });
    const first = await PATCH(request(), { params: Promise.resolve({ planId: "plan" }) });
    const replay = await PATCH(request(), { params: Promise.resolve({ planId: "plan" }) });
    expect(first.status).toBe(200); expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    expect(state.rows.mutationReceipts).toHaveLength(1);
  });
});
