import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { stockLedger } from "@/db/schema/inventory";
import { orders, orderItems } from "@/db/schema/orders";
import { productionPlans, planMaterials } from "@/db/schema/ppc";
import { getTenantOrgId } from "@/lib/tenant";
import { round3 } from "@/lib/inventory/allocation";

export interface StockAvailabilityOptions {
  /** Verified tenant caller; remove only its still-unconsumed eligible commitments. */
  excludeOrderId?: string;
  excludePlanId?: string;
}

export class StockAvailabilityError extends Error {}

export interface StockAvailability {
  onHand: Map<string, number>;
  /** Effective commitments AFTER caller exclusions, not tenant-wide display totals. */
  orderReserved: Map<string, number>;
  planReserved: Map<string, number>;
  /** Union of all three source maps; reservation-only SKUs retain negative free. */
  free: Map<string, number>;
}

// Null alone is deliberate zero; corrupt non-null operands must fail before math.
function numberOrZero(value: string | number | null, field: string): number {
  if (value === null) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || (typeof value === "string" && !value.trim())) {
    throw new StockAvailabilityError(`Nonfinite stock quantity: ${field}.`);
  }
  return n;
}
function add(map: Map<string, number>, sku: string, quantity: number): void {
  if (!sku) return;
  const total = round3((map.get(sku) ?? 0) + quantity);
  if (!Number.isFinite(total)) throw new StockAvailabilityError(`Nonfinite stock balance for ${sku}.`);
  map.set(sku, total);
}

/**
 * Authoritative tenant-scoped reads; failures propagate, never become empty stock.
 * All ledger sources/locations/UOMs contribute by SKU, matching onHandBySku; quantities
 * must already be in the SKU's canonical UOM (no conversion or item/status filtering).
 * This read view alone is NOT a concurrency guarantee or a multi-query MVCC snapshot.
 * Domain mutators must wrap admission AND every write in runInTenantTransaction(orgId,
 * work); all competing reservation/movement writers must use that same tenant lock.
 */
export async function getStockAvailability(options: StockAvailabilityOptions = {}): Promise<StockAvailability> {
  for (const id of [options.excludeOrderId, options.excludePlanId]) {
    if (id !== undefined && (typeof id !== "string" || !id.trim())) {
      throw new StockAvailabilityError("Stock exclusion requires a nonempty entity ID.");
    }
  }
  const orgId = await getTenantOrgId();
  const [ledger, orderRows, planRows] = await Promise.all([
    db.select({ sku: stockLedger.sku, direction: stockLedger.direction, quantity: stockLedger.quantity })
      .from(stockLedger).where(eq(stockLedger.orgId, orgId)),
    db.select({ orderId: orderItems.orderId, sku: orderItems.sku, reservedQty: orderItems.reservedQty, consumedQty: orderItems.consumedQty })
      .from(orderItems).innerJoin(orders, eq(orderItems.orderId, orders.id))
      .where(and(eq(orderItems.orgId, orgId), eq(orders.orgId, orgId), inArray(orders.status, ["Stock_Check", "Dispatch_Pending", "Ready_For_PDI"]))),
    db.select({ planId: planMaterials.planId, sku: planMaterials.sku, allocatedQty: planMaterials.allocatedQty, consumedQty: planMaterials.consumedQty })
      .from(planMaterials).innerJoin(productionPlans, eq(planMaterials.planId, productionPlans.id))
      .where(and(eq(planMaterials.orgId, orgId), eq(productionPlans.orgId, orgId), inArray(productionPlans.status, ["Ready", "Shortage", "In_Production"]))),
  ]);
  // Validate even non-reserving callers; a foreign/missing entity never earns add-back.
  // Do not trim/normalize identifiers: look up exactly the supplied tenant caller.
  if (options.excludeOrderId !== undefined) {
    const matches = await db.select({ id: orders.id }).from(orders)
      .where(and(eq(orders.orgId, orgId), eq(orders.id, options.excludeOrderId)));
    if (!matches.length) throw new StockAvailabilityError("Order not found in this tenant.");
  }
  if (options.excludePlanId !== undefined) {
    const matches = await db.select({ id: productionPlans.id }).from(productionPlans)
      .where(and(eq(productionPlans.orgId, orgId), eq(productionPlans.id, options.excludePlanId)));
    if (!matches.length) throw new StockAvailabilityError("Plan not found in this tenant.");
  }
  const onHand = new Map<string, number>();
  const orderReserved = new Map<string, number>();
  const planReserved = new Map<string, number>();
  for (const row of ledger) add(onHand, row.sku, (row.direction === "Out" ? -1 : 1) * numberOrZero(row.quantity, "ledger.quantity"));
  for (const row of orderRows) {
    if (!row.sku || row.orderId === options.excludeOrderId) continue;
    const held = round3(numberOrZero(row.reservedQty, "order.reservedQty") - numberOrZero(row.consumedQty, "order.consumedQty"));
    if (!Number.isFinite(held)) throw new StockAvailabilityError(`Nonfinite order reservation for ${row.sku}.`);
    if (held > 0) add(orderReserved, row.sku, held);
  }
  for (const row of planRows) {
    if (!row.sku || row.planId === options.excludePlanId) continue;
    const held = numberOrZero(row.allocatedQty, "plan.allocatedQty") - numberOrZero(row.consumedQty, "plan.consumedQty");
    if (held > 0) add(planReserved, row.sku, held);
  }
  const free = new Map<string, number>();
  for (const sku of new Set([...onHand.keys(), ...orderReserved.keys(), ...planReserved.keys()])) {
    free.set(sku, round3((onHand.get(sku) ?? 0) - (orderReserved.get(sku) ?? 0) - (planReserved.get(sku) ?? 0)));
  }
  return { onHand, orderReserved, planReserved, free };
}

export interface StockRequest {
  sku: string;
  quantity: number;
}

export class InsufficientAvailableStockError extends StockAvailabilityError {
  constructor(public readonly sku: string, public readonly requested: number, public readonly available: number) {
    super(`Insufficient stock for ${sku}: requested ${requested}, free ${available}.`);
  }
}

/**
 * Admit the WHOLE caller batch at once, aggregating duplicate SKUs. Calling the single
 * assertion repeatedly is not batch admission: it does not reserve or decrement stock.
 * Quantities must be representable at existing round3 precision (binary floating-point
 * noise is tolerated); extra decimals/below-resolution/overflow are rejected, never
 * rounded down into unsafe admission. Write the same validated quantities.
 * No writes/locks here; the caller owns the full admission + write transaction.
 */
export async function assertStockAvailableMany(
  requests: readonly StockRequest[], options: StockAvailabilityOptions = {},
): Promise<StockAvailability> {
  if (!requests.length) throw new StockAvailabilityError("At least one stock request is required.");
  const required = new Map<string, number>();
  for (const request of requests) {
    if (typeof request.sku !== "string" || !request.sku.trim()) {
      throw new StockAvailabilityError("A nonempty SKU is required.");
    }
    const quantity = round3(request.quantity);
    const precisionNoise = Number.EPSILON * Math.max(1, Math.abs(request.quantity)) * 8;
    if (!Number.isFinite(request.quantity) || request.quantity <= 0 || !Number.isFinite(quantity) || quantity <= 0 || Math.abs(request.quantity - quantity) > precisionNoise) {
      throw new StockAvailabilityError("Quantity must be finite, positive and representable at stock precision.");
    }
    const total = round3((required.get(request.sku) ?? 0) + quantity);
    if (!Number.isFinite(total)) throw new StockAvailabilityError("Aggregate quantity must be finite.");
    required.set(request.sku, total);
  }
  const stock = await getStockAvailability(options);
  for (const [sku, quantity] of required) {
    const available = stock.free.get(sku) ?? 0;
    if (quantity > available) throw new InsufficientAvailableStockError(sku, quantity, available);
  }
  return stock;
}

export async function assertStockAvailable(
  sku: string, quantity: number, options: StockAvailabilityOptions = {},
): Promise<StockAvailability> {
  return assertStockAvailableMany([{ sku, quantity }], options);
}
