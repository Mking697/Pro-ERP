import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  orders as ordersTable,
  pdiInspections,
  tmsActivities,
  tmsShipmentItems,
  tmsShipments,
  transportVendors,
} from "@/db/schema";
import { db } from "@/db/client";
import { findById, insertRecord, listByOrg, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { getOrder, type OrderRecord } from "@/lib/orders/orders";
import { round3 } from "@/lib/leads/quotationMath";
import { emitFmsEvent } from "@/lib/fms/engine";

/**
 * TMS (Transport Management) — leg 4 of the Sales chain (Lead -> Order -> PDI -> TMS ->
 * Dispatch, Dispatch not built yet). See src/db/schema/tms.ts's own header comment for the
 * full design reasoning. Built as its own hardcoded flow, not a generic FMS Template,
 * matching Purchase FMS/Order FMS/PDI's precedent (see CLAUDE.md).
 *
 * This file statically imports orders.ts (for getOrder()/OrderRecord, and
 * setTransportArrangedBy()) — TMS has no order-header logic of its own, it only ever reads
 * an order's own items/status live and writes its own shipment rows. orders.ts must
 * therefore never import this file back (it doesn't need to: "is this order fully shipped"
 * is a TMS-only question, orders.ts never asks it).
 */

export class TmsError extends Error {}

export type TmsShipmentStatus = "Pending" | "At_Loading_Dock";

export type TmsActivityKind = "Note" | "Shipment_Planned" | "Follow_Up" | "Loading_Dock_Confirmed";

export interface TmsShipmentItemRecord {
  lineNo: string;
  sku: string;
  itemName: string;
  uom: string;
  qty: number;
}

export interface TmsShipmentRecord {
  id: string;
  orderId: string;
  transportVendorId: string;
  vendorName: string;
  vehicleSize: string;
  vehiclePrice: number;
  fromWarehouse: string;
  toAddress: string;
  vehicleNo: string;
  driverContactNo: string;
  status: TmsShipmentStatus;
  loadingDockConfirmedBy: string;
  loadingDockConfirmedAt: string;
  createdBy: string;
  createdAt: string;
  items: TmsShipmentItemRecord[];
}

export interface TmsActivityRecord {
  id: string;
  orderId: string;
  kind: TmsActivityKind;
  message: string;
  actorId: string;
  createdAt: string;
}

/** Per order-line, how much of it has actually been allocated to a shipment so far (any
 * shipment status — see this file's own header note on why "fully shipped" is a pure
 * quantity sum, not gated on Loading Dock confirmation). */
export interface TmsLineProgress {
  lineNo: string;
  sku: string;
  itemName: string;
  uom: string;
  qty: number;
  shippedQty: number;
  remainingQty: number;
}

export interface TmsShipmentProgress {
  lines: TmsLineProgress[];
  fullyShipped: boolean;
  partiallyShipped: boolean;
}

export interface TmsOrderCandidate {
  order: OrderRecord;
  progress: TmsShipmentProgress;
  /** True when orders.transportArrangedBy is still null — an order created before that
   * column existed. Surfaced, not silently excluded (see CLAUDE.md's TMS section). */
  needsTransportDecision: boolean;
}

type TmsShipmentRow = InferSelectModel<typeof tmsShipments>;
type TmsShipmentItemRow = InferSelectModel<typeof tmsShipmentItems>;
type TmsActivityRow = InferSelectModel<typeof tmsActivities>;

function rowToActivity(row: TmsActivityRow): TmsActivityRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    kind: row.kind,
    message: row.message,
    actorId: row.actorId,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToShipmentItem(row: TmsShipmentItemRow): TmsShipmentItemRecord {
  return {
    lineNo: row.lineNo,
    sku: row.sku,
    itemName: row.itemName,
    uom: row.uom,
    qty: Number(row.qty) || 0,
  };
}

async function loadShipmentItems(orgId: string, shipmentId: string): Promise<TmsShipmentItemRecord[]> {
  const rows = await db
    .select()
    .from(tmsShipmentItems)
    .where(and(eq(tmsShipmentItems.orgId, orgId), eq(tmsShipmentItems.shipmentId, shipmentId)));
  return rows.map(rowToShipmentItem).sort((a, b) => Number(a.lineNo) - Number(b.lineNo));
}

async function rowToShipment(
  row: TmsShipmentRow,
  vendorNameById: Map<string, string>
): Promise<TmsShipmentRecord> {
  return {
    id: row.id,
    orderId: row.orderId,
    transportVendorId: row.transportVendorId,
    vendorName: row.transportVendorId ? vendorNameById.get(row.transportVendorId) ?? "" : "",
    vehicleSize: row.vehicleSize,
    vehiclePrice: Number(row.vehiclePrice) || 0,
    fromWarehouse: row.fromWarehouse,
    toAddress: row.toAddress,
    vehicleNo: row.vehicleNo,
    driverContactNo: row.driverContactNo,
    status: row.status,
    loadingDockConfirmedBy: row.loadingDockConfirmedBy,
    loadingDockConfirmedAt: row.loadingDockConfirmedAt ? row.loadingDockConfirmedAt.toISOString() : "",
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    items: await loadShipmentItems(row.orgId, row.id),
  };
}

async function vendorNameMap(orgId: string, vendorIds: string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(vendorIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  const rows = await db
    .select()
    .from(transportVendors)
    .where(and(eq(transportVendors.orgId, orgId), inArray(transportVendors.id, ids)));
  return new Map(rows.map((r) => [r.id, r.vendorName]));
}

async function logActivity(
  orgId: string,
  orderId: string,
  kind: TmsActivityKind,
  message: string,
  actorId: string
): Promise<void> {
  await insertRecord(tmsActivities, {
    id: generateId("TMA"),
    orgId,
    orderId,
    kind,
    message,
    actorId,
  });
}

// ---------------------------------------------------------------------------
// Shipment progress — "how much of this order has actually been shipped"
// ---------------------------------------------------------------------------

/**
 * Sums tms_shipment_items.qty across every one of the order's own shipments, per SKU —
 * deliberately across every shipment regardless of status (Pending or At_Loading_Dock
 * alike), matching the spec's own wording exactly ("sum across every tms_shipments row for
 * that order"). A truck that's been planned but not yet physically confirmed at the loading
 * dock still counts as "spoken for" — the order is no longer waiting on a *decision*, only
 * on the truck showing up, which is a separate, later fact (see confirmLoadingDock()).
 */
async function shippedQtyBySku(orgId: string, orderId: string): Promise<Map<string, number>> {
  const shipmentRows = await db
    .select()
    .from(tmsShipments)
    .where(and(eq(tmsShipments.orgId, orgId), eq(tmsShipments.orderId, orderId)));
  if (shipmentRows.length === 0) return new Map();

  const shipmentIds = shipmentRows.map((s) => s.id);
  const itemRows = await db
    .select()
    .from(tmsShipmentItems)
    .where(and(eq(tmsShipmentItems.orgId, orgId), inArray(tmsShipmentItems.shipmentId, shipmentIds)));

  const out = new Map<string, number>();
  for (const row of itemRows) {
    const qty = Number(row.qty) || 0;
    if (qty <= 0 || !row.sku) continue;
    out.set(row.sku, round3((out.get(row.sku) ?? 0) + qty));
  }
  return out;
}

export async function getShipmentProgress(orderId: string, order?: OrderRecord): Promise<TmsShipmentProgress> {
  const orgId = await getTenantOrgId();
  const ord = order ?? (await getOrder(orderId));
  if (!ord) throw new TmsError("Order nahi mila.");

  const shipped = await shippedQtyBySku(orgId, orderId);

  // Aggregate the order's own lines by SKU first — two lines of the same SKU on one order
  // share a single "how much is left" pool, matching the spec's own wording ("compare to
  // the order line's own qty" summed by SKU across the order, not per specific line row).
  const qtyBySku = new Map<string, number>();
  const displayBySku = new Map<string, { itemName: string; uom: string; lineNo: string }>();
  for (const line of ord.items) {
    qtyBySku.set(line.sku, round3((qtyBySku.get(line.sku) ?? 0) + line.qty));
    if (!displayBySku.has(line.sku)) {
      displayBySku.set(line.sku, { itemName: line.itemName, uom: line.uom, lineNo: line.lineNo });
    }
  }

  const lines: TmsLineProgress[] = Array.from(qtyBySku.entries()).map(([sku, qty]) => {
    const shippedQty = round3(Math.min(shipped.get(sku) ?? 0, qty));
    const remainingQty = round3(Math.max(0, qty - shippedQty));
    const display = displayBySku.get(sku)!;
    return { lineNo: display.lineNo, sku, itemName: display.itemName, uom: display.uom, qty, shippedQty, remainingQty };
  });

  const fullyShipped = lines.length > 0 && lines.every((l) => l.remainingQty <= 0);
  const partiallyShipped = !fullyShipped && lines.some((l) => l.shippedQty > 0);

  return { lines, fullyShipped, partiallyShipped };
}

// ---------------------------------------------------------------------------
// Intake — Passed-PDI orders not yet fully shipped
// ---------------------------------------------------------------------------

/**
 * Every order whose PDI has Passed and isn't yet fully shipped — mirrors PDI's/Order FMS's
 * own listIntakeCandidates(), one level up the chain. An order with `transportArrangedBy`
 * still null is included, not excluded (see TmsOrderCandidate's own comment) — the intake
 * screen is exactly where that gap gets surfaced and closed.
 */
export async function listIntakeCandidates(): Promise<TmsOrderCandidate[]> {
  const orgId = await getTenantOrgId();
  const passedRows = await db
    .select()
    .from(pdiInspections)
    .where(and(eq(pdiInspections.orgId, orgId), eq(pdiInspections.status, "Passed")));

  const result: TmsOrderCandidate[] = [];
  for (const row of passedRows) {
    const order = await getOrder(row.orderId);
    if (!order) continue;
    const progress = await getShipmentProgress(order.id, order);
    if (progress.fullyShipped) continue;
    result.push({ order, progress, needsTransportDecision: order.transportArrangedBy === null });
  }

  return result.sort((a, b) => (a.order.createdAt < b.order.createdAt ? 1 : -1));
}

/** Every order whose PDI has Passed AND is now fully shipped — a simple historical list,
 * read-only from this screen's point of view. */
export async function listFullyShipped(): Promise<TmsOrderCandidate[]> {
  const orgId = await getTenantOrgId();
  const passedRows = await db
    .select()
    .from(pdiInspections)
    .where(and(eq(pdiInspections.orgId, orgId), eq(pdiInspections.status, "Passed")));

  const result: TmsOrderCandidate[] = [];
  for (const row of passedRows) {
    const order = await getOrder(row.orderId);
    if (!order) continue;
    const progress = await getShipmentProgress(order.id, order);
    if (!progress.fullyShipped) continue;
    result.push({ order, progress, needsTransportDecision: order.transportArrangedBy === null });
  }

  return result.sort((a, b) => (a.order.createdAt < b.order.createdAt ? 1 : -1));
}

export interface TmsOrderDetail {
  order: OrderRecord;
  progress: TmsShipmentProgress;
  shipments: TmsShipmentRecord[];
  activities: TmsActivityRecord[];
}

export async function getOrderTmsDetail(orderId: string): Promise<TmsOrderDetail | null> {
  const orgId = await getTenantOrgId();
  const order = await getOrder(orderId);
  if (!order) return null;

  const progress = await getShipmentProgress(orderId, order);

  const shipmentRows = await db
    .select()
    .from(tmsShipments)
    .where(and(eq(tmsShipments.orgId, orgId), eq(tmsShipments.orderId, orderId)))
    .orderBy(desc(tmsShipments.createdAt));
  const vendorMap = await vendorNameMap(
    orgId,
    shipmentRows.map((r) => r.transportVendorId)
  );
  const shipments = await Promise.all(shipmentRows.map((r) => rowToShipment(r, vendorMap)));

  const activityRows = await db
    .select()
    .from(tmsActivities)
    .where(and(eq(tmsActivities.orgId, orgId), eq(tmsActivities.orderId, orderId)))
    .orderBy(desc(tmsActivities.createdAt));

  return { order, progress, shipments, activities: activityRows.map(rowToActivity) };
}

/** Every shipment across every order, optionally filtered by status — the "Shipments"
 * board tab. Enriched with the order's own party name so the list is readable without a
 * second click. */
export interface TmsShipmentListRow extends TmsShipmentRecord {
  partyName: string;
}

export async function listShipments(status?: TmsShipmentStatus): Promise<TmsShipmentListRow[]> {
  const orgId = await getTenantOrgId();
  const rows = status
    ? await db
        .select()
        .from(tmsShipments)
        .where(and(eq(tmsShipments.orgId, orgId), eq(tmsShipments.status, status)))
    : await listByOrg(tmsShipments, orgId);

  const sorted = [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const vendorMap = await vendorNameMap(orgId, sorted.map((r) => r.transportVendorId));

  const orderIds = Array.from(new Set(sorted.map((r) => r.orderId)));
  const orderRows =
    orderIds.length > 0
      ? await db.select().from(ordersTable).where(and(eq(ordersTable.orgId, orgId), inArray(ordersTable.id, orderIds)))
      : [];
  const partyNameByOrderId = new Map(orderRows.map((o) => [o.id, o.partyName]));

  const result: TmsShipmentListRow[] = [];
  for (const row of sorted) {
    const shipment = await rowToShipment(row, vendorMap);
    result.push({ ...shipment, partyName: partyNameByOrderId.get(row.orderId) ?? "" });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Planning a shipment — one function for both Self and Party, branching on the
// order's own transportArrangedBy (see src/db/schema/tms.ts's own header comment
// for why both branches share one row shape).
// ---------------------------------------------------------------------------

export interface PlanShipmentLineInput {
  sku: string;
  qty: number;
}

export interface PlanShipmentInput {
  /** Required, and used as-is, only when the order is Self-arranged — ignored (forced
   * blank/zero) for a Party-arranged shipment, see this schema's own comment on
   * transportVendorId/vehiclePrice. */
  transportVendorId?: string;
  vehicleSize?: string;
  vehiclePrice?: number;
  fromWarehouse?: string;
  toAddress?: string;
  vehicleNo?: string;
  driverContactNo?: string;
  items: PlanShipmentLineInput[];
}

export async function planShipment(
  orderId: string,
  input: PlanShipmentInput,
  actorId: string
): Promise<TmsShipmentRecord> {
  const orgId = await getTenantOrgId();
  const order = await getOrder(orderId);
  if (!order) throw new TmsError("Order nahi mila.");
  if (!order.transportArrangedBy) {
    throw new TmsError("Pehle transport arrangement (Self/Party) set karein.");
  }
  // OrderRecord doesn't carry pdiId itself (see orders.ts) — queried directly here by
  // orderId instead, same reasoning as listIntakeCandidates()'s own query above.
  const pdiRows = await db
    .select()
    .from(pdiInspections)
    .where(and(eq(pdiInspections.orgId, orgId), eq(pdiInspections.orderId, orderId)))
    .limit(1);
  const pdiRow = pdiRows[0];
  if (!pdiRow || pdiRow.status !== "Passed") {
    throw new TmsError("Is order ki PDI abhi Pass nahi hui hai — TMS sirf Passed order ke liye chalta hai.");
  }
  if (!input.items || input.items.length === 0) {
    throw new TmsError("Kam se kam ek line allocate karein.");
  }

  const progress = await getShipmentProgress(orderId, order);
  if (progress.fullyShipped) {
    throw new TmsError("Ye order pehle se poora ship ho chuka hai.");
  }
  const remainingBySku = new Map(progress.lines.map((l) => [l.sku, l]));

  const requestedBySku = new Map<string, number>();
  for (const line of input.items) {
    const qty = round3(line.qty);
    if (!(qty > 0)) {
      throw new TmsError("Har line ki quantity 0 se zyada honi chahiye.");
    }
    const lineInfo = remainingBySku.get(line.sku);
    if (!lineInfo) {
      throw new TmsError(`SKU "${line.sku}" is order me nahi hai.`);
    }
    requestedBySku.set(line.sku, round3((requestedBySku.get(line.sku) ?? 0) + qty));
  }
  for (const [sku, qty] of requestedBySku) {
    const lineInfo = remainingBySku.get(sku)!;
    if (qty > lineInfo.remainingQty) {
      throw new TmsError(
        `SKU "${sku}" ke liye sirf ${lineInfo.remainingQty} ${lineInfo.uom} hi bacha hai — ${qty} allocate nahi ho sakta.`
      );
    }
  }

  let transportVendorId = "";
  let vehicleSize = "";
  let vehiclePrice = 0;

  if (order.transportArrangedBy === "Self") {
    if (!input.transportVendorId?.trim()) {
      throw new TmsError("Self-arranged shipment ke liye Transport Vendor chunna zaroori hai.");
    }
    const vendorRow = await findById(transportVendors, orgId, input.transportVendorId.trim());
    if (!vendorRow) throw new TmsError("Transport Vendor nahi mila.");
    if (!input.vehicleSize?.trim()) {
      throw new TmsError("Vehicle Size dena zaroori hai.");
    }
    if (!(input.vehiclePrice !== undefined && input.vehiclePrice >= 0)) {
      throw new TmsError("Vehicle Price (freight) 0 ya usse zyada hona chahiye.");
    }
    transportVendorId = vendorRow.id;
    vehicleSize = input.vehicleSize.trim();
    vehiclePrice = input.vehiclePrice;
  }
  // Party-arranged: transportVendorId/vehicleSize stay "", vehiclePrice stays 0 — the
  // customer's own arrangement, never this org's cost to plan or pay (see schema comment).

  const shipmentId = generateId("TMS");
  await insertRecord(tmsShipments, {
    id: shipmentId,
    orgId,
    orderId,
    transportVendorId,
    vehicleSize,
    vehiclePrice: String(vehiclePrice),
    fromWarehouse: input.fromWarehouse?.trim() ?? "",
    toAddress: input.toAddress?.trim() ?? "",
    vehicleNo: input.vehicleNo?.trim() ?? "",
    driverContactNo: input.driverContactNo?.trim() ?? "",
    status: "Pending",
    createdBy: actorId,
  });

  let lineNo = 1;
  for (const line of input.items) {
    const lineInfo = remainingBySku.get(line.sku)!;
    await insertRecord(tmsShipmentItems, {
      shipmentId,
      orgId,
      lineNo: String(lineNo),
      sku: line.sku,
      itemName: lineInfo.itemName,
      uom: lineInfo.uom,
      qty: String(round3(line.qty)),
    });
    lineNo += 1;
  }

  const kindLabel = order.transportArrangedBy === "Self" ? "Self-arranged" : "Party-arranged (pickup expected)";
  await logActivity(
    orgId,
    orderId,
    "Shipment_Planned",
    `Shipment ${shipmentId} plan kiya gaya (${kindLabel}) — ${input.items.length} line(s).`,
    actorId
  );

  const vendorMap = await vendorNameMap(orgId, [transportVendorId]);
  const created = await findById(tmsShipments, orgId, shipmentId);
  if (!created) throw new TmsError("Shipment ban gaya lekin load nahi ho paya.");
  return rowToShipment(created, vendorMap);
}

// ---------------------------------------------------------------------------
// Follow-up — Party-arranged flow's own "vehicle hasn't shown up yet" nudge.
// No field changes, purely a logged reminder — see this schema's own comment.
// ---------------------------------------------------------------------------

export async function followUpShipment(shipmentId: string, note: string, actorId: string): Promise<void> {
  const orgId = await getTenantOrgId();
  const shipment = await findById(tmsShipments, orgId, shipmentId);
  if (!shipment) throw new TmsError("Shipment nahi mila.");
  if (shipment.status !== "Pending") {
    throw new TmsError("Ye shipment pehle se Loading Dock par confirm ho chuki hai.");
  }

  await logActivity(
    orgId,
    shipment.orderId,
    "Follow_Up",
    note.trim() ? `Follow-up — ${note.trim()}` : `Shipment ${shipmentId} ke liye follow-up kiya gaya — vehicle abhi tak nahi aaya.`,
    actorId
  );
}

// ---------------------------------------------------------------------------
// Loading Dock confirmation — same action for both Self and Party.
// ---------------------------------------------------------------------------

export interface ConfirmLoadingDockInput {
  vehicleNo?: string;
  driverContactNo?: string;
}

export async function confirmLoadingDock(
  shipmentId: string,
  input: ConfirmLoadingDockInput,
  actorId: string
): Promise<TmsShipmentRecord> {
  const orgId = await getTenantOrgId();
  const shipment = await findById(tmsShipments, orgId, shipmentId);
  if (!shipment) throw new TmsError("Shipment nahi mila.");
  if (shipment.status !== "Pending") {
    throw new TmsError("Ye shipment pehle se Loading Dock par confirm ho chuki hai.");
  }

  await updateById(tmsShipments, orgId, shipmentId, {
    status: "At_Loading_Dock",
    loadingDockConfirmedBy: actorId,
    loadingDockConfirmedAt: new Date(),
    vehicleNo: input.vehicleNo?.trim() || shipment.vehicleNo,
    driverContactNo: input.driverContactNo?.trim() || shipment.driverContactNo,
  });

  await logActivity(
    orgId,
    shipment.orderId,
    "Loading_Dock_Confirmed",
    `Shipment ${shipmentId} Loading Dock par confirm ho gaya.${
      input.vehicleNo?.trim() ? ` Vehicle: ${input.vehicleNo.trim()}.` : ""
    }`,
    actorId
  );

  // Best-effort, optional per-module event — mirrors emitFmsEvent's own chaining
  // convention (ORDER_READY_FOR_PDI, ORDER_PDI_PASSED, ...). Fired from here (the actual
  // truck confirmed) rather than from planShipment() (a plan alone isn't dispatch-ready).
  try {
    const progress = await getShipmentProgress(shipment.orderId);
    if (progress.fullyShipped) {
      await logActivity(orgId, shipment.orderId, "Note", "Order ab poora ship ho chuka hai.", "SYSTEM");
      await emitFmsEvent("ORDER_FULLY_SHIPPED", `ORDERS:${shipment.orderId}`);
    }
  } catch (error) {
    console.error(`[tms] fully-shipped follow-up failed for order ${shipment.orderId}:`, error);
  }

  const vendorMap = await vendorNameMap(orgId, [shipment.transportVendorId]);
  const updated = await findById(tmsShipments, orgId, shipmentId);
  if (!updated) throw new TmsError("Update ho gaya lekin shipment load nahi ho paya.");
  return rowToShipment(updated, vendorMap);
}
