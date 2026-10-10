import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const boundary = vi.hoisted(() => ({ select: vi.fn(), tenant: vi.fn(async () => "policy-org") }));
vi.mock("@/db/client", () => ({ db: { select: boundary.select } }));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: boundary.tenant }));
const dialect = new PgDialect();
const queries: { projection: Record<string, unknown>; where: ReturnType<PgDialect["sqlToQuery"]>; join?: ReturnType<PgDialect["sqlToQuery"]> }[] = [];
function rows(...results: (unknown[] | Error)[]) {
  boundary.select.mockImplementation((projection: Record<string, unknown>) => {
    const result = results.shift() ?? [];
    let join: ReturnType<PgDialect["sqlToQuery"]> | undefined;
    const builder = {
      from: () => builder,
      innerJoin: (_table: unknown, condition: Parameters<PgDialect["sqlToQuery"]>[0]) => { join = dialect.sqlToQuery(condition); return builder; },
      where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        queries.push({ projection, where: dialect.sqlToQuery(condition), join });
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
      },
    };
    return builder;
  });
}
beforeEach(() => { vi.clearAllMocks(); queries.length = 0; rows([], [], []); });

describe("authoritative stock availability", () => {
  it("excludes only the verified tenant caller's unconsumed reservations", async () => {
    rows(
      [{ sku: "A", direction: "In", quantity: "20" }],
      [{ orderId: "own-order", sku: "A", reservedQty: "8", consumedQty: "3" }, { orderId: "other-order", sku: "A", reservedQty: "2", consumedQty: "0" }],
      [{ planId: "own-plan", sku: "A", allocatedQty: "6", consumedQty: "4" }, { planId: "other-plan", sku: "A", allocatedQty: "3", consumedQty: "0" }],
      [{ id: "own-order" }], [{ id: "own-plan" }],
    );
    const { getStockAvailability } = await import("@/lib/inventory/availability");
    const stock = await getStockAvailability({ excludeOrderId: "own-order", excludePlanId: "own-plan" });
    expect(stock.onHand.get("A")).toBe(20);
    expect(stock.orderReserved.get("A")).toBe(2);
    expect(stock.planReserved.get("A")).toBe(3);
    expect(stock.free.get("A")).toBe(15);
    expect(queries[3].where.params).toEqual(["policy-org", "own-order"]);
    expect(queries[4].where.params).toEqual(["policy-org", "own-plan"]);
  });

  it.each(["excludeOrderId", "excludePlanId"] as const)("rejects missing or foreign %s rather than granting an exclusion", async (key) => {
    rows([], [], [], []);
    const { getStockAvailability } = await import("@/lib/inventory/availability");
    await expect(getStockAvailability({ [key]: "foreign-or-missing" })).rejects.toThrow(/not found in this tenant/i);
  });

  it.each(["excludeOrderId", "excludePlanId"] as const)("rejects blank %s rather than silently removing the exclusion", async (key) => {
    const { getStockAvailability } = await import("@/lib/inventory/availability");
    await expect(getStockAvailability({ [key]: "" })).rejects.toThrow(/nonempty/i);
    expect(boundary.select).not.toHaveBeenCalled();
  });
  it("asserts all same-SKU request lines against a single shared availability view", async () => {
    const { assertStockAvailableMany, assertStockAvailable } = await import("@/lib/inventory/availability");
    rows([{ sku: "A", direction: "In", quantity: "5" }], [], []);
    await expect(assertStockAvailableMany([{ sku: "A", quantity: 3 }, { sku: "A", quantity: 3 }])).rejects.toMatchObject({ sku: "A", requested: 6, available: 5 });
    expect(queries).toHaveLength(3);
    rows([{ sku: "A", direction: "In", quantity: "0.3" }], [], []);
    expect((await assertStockAvailableMany([{ sku: "A", quantity: 0.1 }, { sku: "A", quantity: 0.2 }])).free.get("A")).toBe(0.3);
    rows([{ sku: "A", direction: "In", quantity: "5" }], [{ orderId: "own", sku: "A", reservedQty: "5", consumedQty: "0" }], [], [{ id: "own" }]);
    expect((await assertStockAvailable("A", 5, { excludeOrderId: "own" })).free.get("A")).toBe(5);
  });

  it.each([NaN, Infinity, -Infinity, 0, -1, 0.0001, 1.0004, 1e308])("rejects invalid or unrepresentable requested quantity %s before reads", async (quantity) => {
    const { assertStockAvailable } = await import("@/lib/inventory/availability");
    await expect(assertStockAvailable("A", quantity)).rejects.toThrow(/quantity/i);
    expect(boundary.select).not.toHaveBeenCalled();
  });

  it("rejects missing SKUs and empty request batches", async () => {
    const { assertStockAvailable, assertStockAvailableMany } = await import("@/lib/inventory/availability");
    await expect(assertStockAvailable("", 1)).rejects.toThrow(/sku/i);
    await expect(assertStockAvailableMany([])).rejects.toThrow(/at least one/i);
    expect(boundary.select).not.toHaveBeenCalled();
  });

  it("refuses an unknown SKU rather than treating absent free stock as unlimited", async () => {
    const { assertStockAvailable } = await import("@/lib/inventory/availability");
    await expect(assertStockAvailable("UNKNOWN", 1)).rejects.toMatchObject({ sku: "UNKNOWN", available: 0 });
  });

  // Each source operand must reject before sign changes, subtraction or clamping.
  describe.each([
    "ledger.quantity", "order.reservedQty", "order.consumedQty", "plan.allocatedQty", "plan.consumedQty",
  ])("invalid source quantity %s", (field) => {
    it.each([NaN, Infinity, -Infinity, "NaN", "Infinity", "-Infinity", "not-a-number", "", "   "].map((value) => ({ value, label: `${typeof value}:${String(value)}` })))("rejects non-null $label at its source field", async ({ value }) => {
      const ledger = [{ sku: "A", direction: "In", quantity: "10" }];
      const order = { orderId: "o", sku: "A", reservedQty: "0", consumedQty: "0" };
      const plan = { planId: "p", sku: "A", allocatedQty: "0", consumedQty: "0" };
      if (field === "ledger.quantity") rows([...ledger, { sku: "A", direction: "Out", quantity: value }], [], []);
      else if (field.startsWith("order.")) rows(ledger, [{ ...order, [field.split(".")[1]]: value }], []);
      else rows(ledger, [], [{ ...plan, [field.split(".")[1]]: value }]);
      const { assertStockAvailable, StockAvailabilityError } = await import("@/lib/inventory/availability");
      const admission = assertStockAvailable("A", 10);
      await expect(admission).rejects.toBeInstanceOf(StockAvailabilityError);
      await expect(admission).rejects.toThrow(`Nonfinite stock quantity: ${field}.`);
    });

    it("preserves deliberate null-as-zero", async () => {
      const ledger = [{ sku: "A", direction: "In", quantity: "10" }];
      if (field === "ledger.quantity") rows([...ledger, { sku: "A", direction: "Out", quantity: null }], [], []);
      else if (field.startsWith("order.")) rows(ledger, [{ orderId: "o", sku: "A", reservedQty: "0", consumedQty: "0", [field.split(".")[1]]: null }], []);
      else rows(ledger, [], [{ planId: "p", sku: "A", allocatedQty: "0", consumedQty: "0", [field.split(".")[1]]: null }]);
      const { assertStockAvailable } = await import("@/lib/inventory/availability");
      expect((await assertStockAvailable("A", 10)).free.get("A")).toBe(10);
    });
  });

  it("fails closed when numeric order data would produce a nonfinite balance", async () => {
    rows([], [{ orderId: "bad", sku: "A", reservedQty: "Infinity", consumedQty: "Infinity" }], []);
    const { getStockAvailability } = await import("@/lib/inventory/availability");
    await expect(getStockAvailability()).rejects.toThrow(/nonfinite/i);
  });

  it.each([0, 1, 2, 3, 4])("propagates the original failure at authoritative read boundary %s", async (index) => {
    const failure = new Error(`database failed at ${index}`);
    const results: (unknown[] | Error)[] = [[], [], [], [{ id: "o" }], [{ id: "p" }]];
    results[index] = failure;
    rows(...results);
    const { getStockAvailability } = await import("@/lib/inventory/availability");
    await expect(getStockAvailability({ excludeOrderId: "o", excludePlanId: "p" })).rejects.toBe(failure);
  });

  it("preserves existing per-step rounding, nullable quantities, blank SKUs and non-Out direction semantics", async () => {
    rows(
      [{ sku: "A", direction: "In", quantity: "3.3" }, { sku: "A", direction: "Out", quantity: "1.1" }, { sku: "A", direction: "legacy", quantity: "0.0006" }, { sku: "A", direction: "In", quantity: "0.0006" }, { sku: "", direction: "In", quantity: "99" }],
      [{ orderId: "o", sku: "A", reservedQty: "0.1006", consumedQty: "0" }, { orderId: "o", sku: "A", reservedQty: "0.1006", consumedQty: "0" }, { orderId: "o", sku: "OVER", reservedQty: "1", consumedQty: "2" }],
      [{ planId: "p", sku: "A", allocatedQty: "0.1006", consumedQty: null }, { planId: "p", sku: "A", allocatedQty: "0.1006", consumedQty: "0" }, { planId: "p", sku: "OVER", allocatedQty: null, consumedQty: "1" }],
    );
    const { getStockAvailability } = await import("@/lib/inventory/availability");
    const stock = await getStockAvailability();
    expect(stock.onHand.get("A")).toBe(2.202);
    expect(stock.orderReserved.get("A")).toBe(0.202);
    expect(stock.planReserved.get("A")).toBe(0.202);
    expect(stock.free).toEqual(new Map([["A", 1.798]]));
  });

  it("deducts only remaining order and production commitments from every ledger movement", async () => {
    rows(
      [{ sku: "A", direction: "In", quantity: "10.3" }, { sku: "A", direction: "Out", quantity: "1.1" }],
      [{ orderId: "o1", sku: "A", reservedQty: "4", consumedQty: "1" }, { orderId: "o2", sku: "ONLY-ORDER", reservedQty: "2", consumedQty: "0" }],
      [{ planId: "p1", sku: "A", allocatedQty: "3", consumedQty: "1" }, { planId: "p2", sku: "ONLY-PLAN", allocatedQty: "1", consumedQty: null }],
    );
    const { getStockAvailability } = await import("@/lib/inventory/availability");
    const stock = await getStockAvailability();
    expect(stock.onHand).toEqual(new Map([["A", 9.2]]));
    expect(stock.orderReserved).toEqual(new Map([["A", 3], ["ONLY-ORDER", 2]]));
    expect(stock.planReserved).toEqual(new Map([["A", 2], ["ONLY-PLAN", 1]]));
    expect(stock.free).toEqual(new Map([["A", 4.2], ["ONLY-ORDER", -2], ["ONLY-PLAN", -1]]));
    expect(queries).toHaveLength(3);
    expect(Object.keys(queries[0].projection)).toEqual(["sku", "direction", "quantity"]);
    for (const query of queries) expect(query.where.params).toContain("policy-org");
    expect(queries[1].where.params).toEqual(["policy-org", "policy-org", "Stock_Check", "Dispatch_Pending", "Ready_For_PDI"]);
    expect(queries[2].where.params).toEqual(["policy-org", "policy-org", "Ready", "Shortage", "In_Production"]);
    expect(queries[1].join?.sql).toContain('"order_items"."order_id" = "orders"."id"');
    expect(queries[2].join?.sql).toContain('"plan_materials"."plan_id" = "production_plans"."id"');
  });
});

describe("disposable local Postgres stock policy", () => {
  it("rejects real PG numeric NaN Out admission and rolls back every fixture row", async () => {
    expect(process.env.DATABASE_URL).toBe("postgresql://pro_erp_test@pro-erp-regression-pg:5432/pro_erp_test?sslmode=disable");
    const real = await vi.importActual<typeof import("@/db/client")>("@/db/client");
    const { randomUUID } = await import("node:crypto");
    const { eq } = await import("drizzle-orm");
    const { organizations } = await import("@/db/schema/platform");
    const { stockLedger } = await import("@/db/schema/inventory");
    const { assertStockAvailable, StockAvailabilityError } = await import("@/lib/inventory/availability");
    const orgId = `stock-policy-nan-${randomUUID()}`;
    const sku = `${orgId}-sku`;
    boundary.tenant.mockResolvedValue(orgId);
    boundary.select.mockImplementation((...args: Parameters<typeof real.db.select>) => real.db.select(...args));
    try {
      const admission = real.runInTenantTransaction(orgId, async () => {
        await real.db.insert(organizations).values({ id: orgId, orgName: "Disposable NaN stock policy", slug: orgId, ownerEmail: "stock-policy@example.invalid" });
        await real.db.insert(stockLedger).values([
          { id: `${orgId}-in`, orgId, sku, direction: "In", quantity: "10", source: "Opening" },
          { id: `${orgId}-out`, orgId, sku, direction: "Out", quantity: "NaN", source: "Manual" },
        ]);
        expect(await real.db.select({ quantity: stockLedger.quantity }).from(stockLedger).where(eq(stockLedger.id, `${orgId}-out`))).toEqual([{ quantity: "NaN" }]);
        await assertStockAvailable(sku, 10);
        // Roll back even if admission regresses; this fallback must fail the test.
        throw new Error("Unexpected NaN fixture admission");
      });
      await expect(admission).rejects.toBeInstanceOf(StockAvailabilityError);
      await expect(admission).rejects.toThrow("Nonfinite stock quantity: ledger.quantity.");
    } finally {
      expect(await real.db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, orgId))).toEqual([]);
      expect(await real.db.select({ id: stockLedger.id }).from(stockLedger).where(eq(stockLedger.orgId, orgId))).toEqual([]);
    }
  }, 60000);

  it("executes the real tenant/status joins, caller exclusions and rollback-scoped fixture admission", async () => {
    // This config sets ONLY the approved local pro_erp_test target, never dotenv.
    expect(process.env.DATABASE_URL).toBe("postgresql://pro_erp_test@pro-erp-regression-pg:5432/pro_erp_test?sslmode=disable");
    const real = await vi.importActual<typeof import("@/db/client")>("@/db/client");
    const { randomUUID } = await import("node:crypto");
    const { eq, inArray } = await import("drizzle-orm");
    const { organizations } = await import("@/db/schema/platform");
    const { stockLedger } = await import("@/db/schema/inventory");
    const { orders, orderItems, orderStatusEnum } = await import("@/db/schema/orders");
    const { productionPlans, planMaterials, planStatusEnum } = await import("@/db/schema/ppc");
    const { getStockAvailability, assertStockAvailableMany } = await import("@/lib/inventory/availability");
    const orgId = `stock-policy-${randomUUID()}`;
    const foreignOrg = `${orgId}-foreign`;
    const sku = `${orgId}-sku`;
    boundary.tenant.mockResolvedValue(orgId);
    boundary.select.mockImplementation((...args: Parameters<typeof real.db.select>) => real.db.select(...args));
    const rollback = new Error("stock-policy-fixture-rollback");
    const orderId = (status: string) => `${orgId}-order-${status}`;
    const planId = (status: string) => `${orgId}-plan-${status}`;
    await expect(real.runInTenantTransaction(orgId, async () => {
      await real.db.insert(organizations).values([orgId, foreignOrg].map((id) => ({ id, orgName: "Disposable stock policy", slug: id, ownerEmail: "stock-policy@example.invalid" })));
      await real.db.insert(orders).values([
        ...orderStatusEnum.enumValues.map((status) => ({ id: orderId(status), orgId, status })),
        { id: `${orgId}-foreign-order`, orgId: foreignOrg, status: "Stock_Check" as const },
      ]);
      await real.db.insert(productionPlans).values([
        ...planStatusEnum.enumValues.map((status) => ({ id: planId(status), orgId, productName: "Fixture", productSku: sku, plannedQty: "10", status })),
        { id: `${orgId}-foreign-plan`, orgId: foreignOrg, productName: "Foreign fixture", productSku: sku, plannedQty: "10", status: "Ready" as const },
      ]);
      await real.db.insert(orderItems).values([
        ...orderStatusEnum.enumValues.map((status) => ({ orderId: orderId(status), orgId, lineNo: "1", sku, reservedQty: status === "Ready_For_PDI" ? "8" : "5", consumedQty: status === "Ready_For_PDI" ? "3" : "0", uom: "pcs" })),
        { orderId: `${orgId}-foreign-order`, orgId: foreignOrg, lineNo: "1", sku, reservedQty: "999" },
        { orderId: `${orgId}-foreign-order`, orgId, lineNo: "2", sku, reservedQty: "99" },
        { orderId: orderId("Stock_Check"), orgId: foreignOrg, lineNo: "2", sku, reservedQty: "99" },
        { orderId: `${orgId}-orphan-order`, orgId, lineNo: "1", sku, reservedQty: "99" },
        { orderId: orderId("Stock_Check"), orgId, lineNo: "3", sku: "", reservedQty: "99" },
        { orderId: orderId("Stock_Check"), orgId, lineNo: "4", sku: `${orgId}-overconsumed`, reservedQty: "1", consumedQty: "2" },
      ]);
      await real.db.insert(planMaterials).values([
        ...planStatusEnum.enumValues.map((status) => ({ planId: planId(status), orgId, sku, allocatedQty: status === "In_Production" ? "10" : "6", consumedQty: status === "In_Production" ? "4" : null, status: "Consumed" as const, uom: "kg" })),
        { planId: `${orgId}-foreign-plan`, orgId: foreignOrg, sku, allocatedQty: "999" },
        { planId: `${orgId}-foreign-plan`, orgId, sku: `${sku}-cross-parent`, allocatedQty: "99" },
        { planId: planId("Ready"), orgId: foreignOrg, sku: `${sku}-cross-child`, allocatedQty: "99" },
        { planId: `${orgId}-orphan-plan`, orgId, sku, allocatedQty: "99" },
        { planId: planId("Ready"), orgId, sku: "", allocatedQty: "99" },
        { planId: planId("Ready"), orgId, sku: `${orgId}-overconsumed`, allocatedQty: "1", consumedQty: "2" },
      ]);
      const sources = ["Opening", "Manual", "Form", "IQC", "Production", "Production_Output", "Indent_Receipt", "Adjustment", "FMS"];
      await real.db.insert(stockLedger).values([
        { id: `${orgId}-opening`, orgId, sku, direction: "In", quantity: "100", source: "Opening", uom: "pcs" },
        ...sources.map((source, i) => ({ id: `${orgId}-source-${i}`, orgId, sku, direction: "In", quantity: "1", source, uom: i % 2 ? "kg" : "pcs", location: String(i) })),
        { id: `${orgId}-dispatch`, orgId, sku, direction: "Out", quantity: "3", source: "Dispatch" },
        { id: `${orgId}-production-out`, orgId, sku, direction: "Out", quantity: "4", source: "Production" },
        { id: `${orgId}-foreign-ledger`, orgId: foreignOrg, sku, direction: "In", quantity: "999", source: "Opening" },
      ]);
      const base = await getStockAvailability();
      expect(base.onHand).toEqual(new Map([[sku, 102]]));
      expect(base.orderReserved).toEqual(new Map([[sku, 15]]));
      expect(base.planReserved).toEqual(new Map([[sku, 18]]));
      expect(base.free).toEqual(new Map([[sku, 69]]));
      const own = await getStockAvailability({ excludeOrderId: orderId("Ready_For_PDI"), excludePlanId: planId("In_Production") });
      expect(own.free.get(sku)).toBe(80);
      expect((await getStockAvailability({ excludeOrderId: orderId("Cancelled"), excludePlanId: planId("Completed") })).free).toEqual(base.free);
      await expect(getStockAvailability({ excludeOrderId: `${orgId}-foreign-order` })).rejects.toThrow(/not found in this tenant/i);
      await expect(getStockAvailability({ excludePlanId: `${orgId}-foreign-plan` })).rejects.toThrow(/not found in this tenant/i);
      await expect(assertStockAvailableMany([{ sku, quantity: 35 }, { sku, quantity: 35 }])).rejects.toMatchObject({ requested: 70, available: 69 });
      await expect(assertStockAvailableMany([{ sku, quantity: 40 }, { sku, quantity: 40 }], { excludeOrderId: orderId("Ready_For_PDI"), excludePlanId: planId("In_Production") })).resolves.toMatchObject({ free: own.free });
      // Prove the fixture exists on the active transaction before deliberate rollback.
      expect(await real.db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, orgId))).toEqual([{ id: orgId }]);
      throw rollback;
    })).rejects.toBe(rollback);
    expect(await real.db.select({ id: organizations.id }).from(organizations).where(inArray(organizations.id, [orgId, foreignOrg]))).toEqual([]);
  }, 60000);
});
