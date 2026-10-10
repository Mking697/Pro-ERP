import type { InferSelectModel } from "drizzle-orm";
import { and, eq, sql } from "drizzle-orm";
import {
  dispatchActivities,
  dispatches,
  invoices,
  orderItems,
  stockLedger,
  tmsShipmentItems,
  tmsShipments,
  transportVendors,
} from "@/db/schema";
import { db, runInTenantTransaction } from "@/db/client";
import { findById, insertRecord, listByOrg, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { getOrder, type OrderRecord } from "@/lib/orders/orders";
import { getUserById } from "@/lib/auth/users";
import { findItem } from "@/lib/inventory/items";
import { assertStockAvailableMany } from "@/lib/inventory/availability";
import { round3 } from "@/lib/inventory/allocation";
import { computeTatDeadline } from "@/lib/fms/calendar";
import type { FmsTatUnit } from "@/lib/fms/templates";
import { startFmsInstance } from "@/lib/fms/engine";
import { listFmsTemplates } from "@/lib/fms/templates";
import type { ModuleAccessKey } from "@/lib/moduleAccess";

/**
 * Dispatch — leg 5, the last leg of the Sales chain (Lead -> Order -> PDI -> TMS ->
 * Dispatch). Built as its own hardcoded flow, not a generic FMS Template, same reasoning as
 * every other leg (see CLAUDE.md). See src/db/schema/dispatch.ts's own header comment for
 * the full design reasoning behind every column here.
 *
 * Operates at the exact same granularity TMS itself uses: one row per `tms_shipments` row
 * (a physical vehicle), not per order — an order can have several shipments, each with its
 * own Gate Pass and its own Confirm/Mark-Dispatched lifecycle. The append-only activity
 * timeline (`dispatch_activities`) is scoped by `orderId`, not `dispatchId`, though — same
 * convention as `tms_activities`/`order_activities`: an order's Dispatch story is read as one
 * timeline even when it took several trucks.
 *
 * Statically imports orders.ts (getOrder()) and tms.ts's own tables directly (not tms.ts's
 * functions — those are private to that file) the same way accounts.ts does; this file owns
 * no order-header or shipment-planning logic of its own.
 */

export class DispatchError extends Error {}

export type DispatchStatus = "In_Transit" | "Dispatched" | "Delivered";

export type DispatchActivityKind =
  | "Note"
  | "Gate_Pass_Issued"
  | "Assigned"
  | "Dispatched"
  | "Delivered";

export interface DispatchItemRecord {
  lineNo: string;
  sku: string;
  itemName: string;
  uom: string;
  qty: number;
}

export interface DispatchRecord {
  id: string;
  orderId: string;
  shipmentId: string;
  gatePassNo: string;
  gatePassAttachmentUrl: string;
  assignedTo: string;
  assignedToName: string;
  tatValue: number;
  tatUnit: string;
  tatDeadline: string;
  status: DispatchStatus;
  proofOfDispatchUrl: string;
  dispatchedBy: string;
  dispatchedAt: string;
  podAttachmentUrl: string;
  deliveredBy: string;
  deliveredAt: string;
  createdBy: string;
  createdAt: string;
  items: DispatchItemRecord[];
}

export interface DispatchActivityRecord {
  id: string;
  orderId: string;
  kind: DispatchActivityKind;
  message: string;
  actorId: string;
  createdAt: string;
}

type DispatchRow = InferSelectModel<typeof dispatches>;
type TmsShipmentRow = InferSelectModel<typeof tmsShipments>;
type TmsShipmentItemRow = InferSelectModel<typeof tmsShipmentItems>;
type DispatchActivityRow = InferSelectModel<typeof dispatchActivities>;

function rowToActivity(row: DispatchActivityRow): DispatchActivityRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    kind: row.kind,
    message: row.message,
    actorId: row.actorId,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadShipmentItemRows(orgId: string, shipmentId: string): Promise<TmsShipmentItemRow[]> {
  const rows = await db
    .select()
    .from(tmsShipmentItems)
    .where(and(eq(tmsShipmentItems.orgId, orgId), eq(tmsShipmentItems.shipmentId, shipmentId)));
  return rows.sort((a, b) => Number(a.lineNo) - Number(b.lineNo));
}

function itemRowToRecord(row: TmsShipmentItemRow): DispatchItemRecord {
  return {
    lineNo: row.lineNo,
    sku: row.sku,
    itemName: row.itemName,
    uom: row.uom,
    qty: Number(row.qty) || 0,
  };
}

async function rowToDispatch(row: DispatchRow): Promise<DispatchRecord> {
  const items = await loadShipmentItemRows(row.orgId, row.shipmentId);
  const assignee = row.assignedTo ? await getUserById(row.assignedTo) : null;
  return {
    id: row.id,
    orderId: row.orderId,
    shipmentId: row.shipmentId,
    gatePassNo: row.gatePassNo,
    gatePassAttachmentUrl: row.gatePassAttachmentUrl,
    assignedTo: row.assignedTo,
    assignedToName: assignee?.Full_Name ?? "",
    tatValue: Number(row.tatValue) || 0,
    tatUnit: row.tatUnit,
    tatDeadline: row.tatDeadline ? row.tatDeadline.toISOString() : "",
    status: row.status,
    proofOfDispatchUrl: row.proofOfDispatchUrl,
    dispatchedBy: row.dispatchedBy,
    dispatchedAt: row.dispatchedAt ? row.dispatchedAt.toISOString() : "",
    podAttachmentUrl: row.podAttachmentUrl,
    deliveredBy: row.deliveredBy,
    deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : "",
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    items: items.map(itemRowToRecord),
  };
}

async function logActivity(
  orgId: string,
  orderId: string,
  kind: DispatchActivityKind,
  message: string,
  actorId: string
): Promise<void> {
  await insertRecord(dispatchActivities, {
    id: generateId("DAC"),
    orgId,
    orderId,
    kind,
    message,
    actorId,
  });
}

async function isInvoiceIssued(orgId: string, orderId: string): Promise<boolean> {
  const rows = await db
    .select({ status: invoices.status })
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.orderId, orderId), eq(invoices.status, "Issued")))
    .limit(1);
  return rows[0]?.status === "Issued";
}

async function vendorNameMap(orgId: string, vendorIds: string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(vendorIds.filter(Boolean)));
  if (ids.length === 0) return new Map();
  const rows = await db
    .select()
    .from(transportVendors)
    .where(and(eq(transportVendors.orgId, orgId)));
  return new Map(rows.filter((r) => ids.includes(r.id)).map((r) => [r.id, r.vendorName]));
}

/** True once every one of an order's own `tms_shipments` rows has both a `dispatch_id` set
 * AND that dispatch's own status is `Dispatched` — the terminal state of the whole 5-leg
 * Sales chain. Live-computed, never stored, same convention as every other "progress" check
 * in this chain (TMS's own `fullyShipped`, Order FMS's credit position, ...). An order with
 * zero shipments is never "fully dispatched" — there is nothing to have dispatched yet. */
export async function isOrderFullyDispatched(orderId: string): Promise<boolean> {
  const orgId = await getTenantOrgId();
  const shipmentRows = await db
    .select()
    .from(tmsShipments)
    .where(and(eq(tmsShipments.orgId, orgId), eq(tmsShipments.orderId, orderId)));
  if (shipmentRows.length === 0) return false;

  for (const row of shipmentRows) {
    if (!row.dispatchId) return false;
    const dispatchRow = await findById(dispatches, orgId, row.dispatchId);
    if (!dispatchRow || dispatchRow.status !== "Dispatched") return false;
  }
  return true;
}

/** True once every one of an order's own `tms_shipments` rows has both a `dispatch_id` set
 * AND that dispatch's own status is `Delivered` — the customer-side close, one step further
 * than isOrderFullyDispatched() above (which only requires the transit itself to be done).
 * Live-computed, never stored, same convention. An order with zero shipments is never
 * "fully delivered" — there is nothing to have delivered yet. */
export async function isOrderFullyDelivered(orderId: string): Promise<boolean> {
  const orgId = await getTenantOrgId();
  const shipmentRows = await db
    .select()
    .from(tmsShipments)
    .where(and(eq(tmsShipments.orgId, orgId), eq(tmsShipments.orderId, orderId)));
  if (shipmentRows.length === 0) return false;

  for (const row of shipmentRows) {
    if (!row.dispatchId) return false;
    const dispatchRow = await findById(dispatches, orgId, row.dispatchId);
    if (!dispatchRow || dispatchRow.status !== "Delivered") return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Intake — At_Loading_Dock shipments not yet handed to Dispatch
// ---------------------------------------------------------------------------

export interface DispatchCandidateShipment {
  id: string;
  orderId: string;
  vendorName: string;
  vehicleSize: string;
  fromWarehouse: string;
  toAddress: string;
  vehicleNo: string;
  driverContactNo: string;
  loadingDockConfirmedAt: string;
  createdAt: string;
  items: DispatchItemRecord[];
}

export interface DispatchCandidate {
  shipment: DispatchCandidateShipment;
  order: OrderRecord;
  /** False surfaces "waiting on invoice" on the candidate itself rather than hiding it —
   * same convention as TMS's own `needsTransportDecision` (see CLAUDE.md's TMS section).
   * Confirm Dispatch itself still refuses when this is false (see confirmDispatch() below);
   * this flag only lets the board explain why a candidate isn't ready yet. */
  invoiceIssued: boolean;
}

/** Every `tms_shipments` row that is `At_Loading_Dock` and not yet handed to Dispatch
 * (`dispatch_id === ''`) — Dispatch's own candidate queue, at the same per-shipment
 * granularity TMS itself uses (see this file's own header comment). */
export async function listIntakeCandidates(): Promise<DispatchCandidate[]> {
  const orgId = await getTenantOrgId();
  const shipmentRows = await db
    .select()
    .from(tmsShipments)
    .where(
      and(
        eq(tmsShipments.orgId, orgId),
        eq(tmsShipments.status, "At_Loading_Dock"),
        eq(tmsShipments.dispatchId, "")
      )
    );

  const vendorMap = await vendorNameMap(orgId, shipmentRows.map((r) => r.transportVendorId));

  const result: DispatchCandidate[] = [];
  for (const row of shipmentRows) {
    const order = await getOrder(row.orderId);
    if (!order) continue;
    const items = await loadShipmentItemRows(orgId, row.id);
    const invoiceIssued = await isInvoiceIssued(orgId, row.orderId);
    result.push({
      shipment: {
        id: row.id,
        orderId: row.orderId,
        vendorName: row.transportVendorId ? vendorMap.get(row.transportVendorId) ?? "" : "",
        vehicleSize: row.vehicleSize,
        fromWarehouse: row.fromWarehouse,
        toAddress: row.toAddress,
        vehicleNo: row.vehicleNo,
        driverContactNo: row.driverContactNo,
        loadingDockConfirmedAt: row.loadingDockConfirmedAt ? row.loadingDockConfirmedAt.toISOString() : "",
        createdAt: row.createdAt.toISOString(),
        items: items.map(itemRowToRecord),
      },
      order,
      invoiceIssued,
    });
  }

  return result.sort((a, b) => (a.shipment.createdAt < b.shipment.createdAt ? 1 : -1));
}

// ---------------------------------------------------------------------------
// Lists — In_Transit / Dispatched boards
// ---------------------------------------------------------------------------

export interface DispatchListRow extends DispatchRecord {
  partyName: string;
  orderFullyDispatched: boolean;
  orderFullyDelivered: boolean;
}

export async function listDispatches(status?: DispatchStatus): Promise<DispatchListRow[]> {
  const orgId = await getTenantOrgId();
  const rows = status
    ? await db.select().from(dispatches).where(and(eq(dispatches.orgId, orgId), eq(dispatches.status, status)))
    : await listByOrg(dispatches, orgId);

  const sorted = [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  const result: DispatchListRow[] = [];
  for (const row of sorted) {
    const record = await rowToDispatch(row);
    const order = await getOrder(row.orderId);
    const orderFullyDispatched = await isOrderFullyDispatched(row.orderId);
    const orderFullyDelivered = await isOrderFullyDelivered(row.orderId);
    result.push({ ...record, partyName: order?.partyName ?? "", orderFullyDispatched, orderFullyDelivered });
  }
  return result;
}

export interface DispatchDetail {
  dispatch: DispatchRecord;
  order: OrderRecord;
  activities: DispatchActivityRecord[];
  orderFullyDispatched: boolean;
  orderFullyDelivered: boolean;
}

export async function getDispatchDetail(dispatchId: string): Promise<DispatchDetail | null> {
  const orgId = await getTenantOrgId();
  const row = await findById(dispatches, orgId, dispatchId);
  if (!row) return null;
  const order = await getOrder(row.orderId);
  if (!order) return null;

  const dispatch = await rowToDispatch(row);
  const activityRows = await db
    .select()
    .from(dispatchActivities)
    .where(and(eq(dispatchActivities.orgId, orgId), eq(dispatchActivities.orderId, row.orderId)))
    .orderBy(dispatchActivities.createdAt);
  const orderFullyDispatched = await isOrderFullyDispatched(row.orderId);
  const orderFullyDelivered = await isOrderFullyDelivered(row.orderId);

  return {
    dispatch,
    order,
    activities: activityRows.map(rowToActivity).reverse(),
    orderFullyDispatched,
    orderFullyDelivered,
  };
}

// ---------------------------------------------------------------------------
// Gate Pass numbering — same read-highest-then-retry-on-collision allocator as
// quotations.quotationNo (src/lib/leads/quotations.ts's allocateQuotationNumber).
// ---------------------------------------------------------------------------

const GATE_PASS_PREFIX = "GP";
const GATE_PASS_CONSTRAINT = "dispatches_org_id_gate_pass_no_unique";

async function allocateGatePassNumber(orgId: string): Promise<string> {
  const existing = await db
    .select({ gatePassNo: dispatches.gatePassNo })
    .from(dispatches)
    .where(eq(dispatches.orgId, orgId));

  const pattern = new RegExp(`^${GATE_PASS_PREFIX}-(\\d+)$`);
  let maxNumber = 0;
  for (const row of existing) {
    const match = pattern.exec(row.gatePassNo);
    if (match) maxNumber = Math.max(maxNumber, Number(match[1]));
  }

  return `${GATE_PASS_PREFIX}-${String(maxNumber + 1).padStart(4, "0")}`;
}

/** True for a Postgres unique-violation (23505) against the given constraint name — same
 * helper quotations.ts's own insertQuotationRow() uses for the identical retry reason. */
/** True for a Postgres unique-violation (23505) against the given constraint name — walks
 * the error's own `cause` chain, since drizzle-orm wraps the real driver error (which
 * carries `code`/`constraint`) inside a DrizzleQueryError whose own properties are only
 * query/params/cause; checking `error.code` directly never matches. */
function isUniqueViolation(error: unknown, constraintName: string): boolean {
  for (let current: unknown = error; current; current = (current as { cause?: unknown } | null)?.cause) {
    if (typeof current !== "object" || current === null) continue;
    const e = current as { code?: unknown; constraint?: unknown; message?: unknown };
    if (e.code === "23505") {
      if (typeof e.constraint === "string") return e.constraint === constraintName;
      return typeof e.message === "string" && e.message.includes(constraintName);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Step 1 — Confirm Dispatch: the load-bearing action.
// ---------------------------------------------------------------------------

const TAT_UNITS: readonly FmsTatUnit[] = ["Minutes", "Hours", "Days"];

export interface ConfirmDispatchInput {
  assignedTo: string;
  tatValue: number;
  tatUnit: FmsTatUnit;
  gatePassAttachmentUrl?: string;
}

/**
 * Issues a Gate Pass, writes the real `stock_ledger` "Out" for exactly what this shipment
 * carries, sets `order_items.consumedQty` for each line shipped, links the shipment to this
 * dispatch, and assigns someone to track it with a TAT computed off their own working-hours
 * calendar. All authoritative reads and writes share the tenant transaction/lock.
 * Ledger rows, guarded exact-line consumption, the shipment claim and activities commit
 * together. Number collisions roll back a savepoint before retrying admission.
 *
 * Central stock admission excludes this order's own outstanding reservation, avoiding
 * double subtraction while still protecting other orders' and PPC plans' commitments.
 * Each consumed increment is additionally capped by its exact line's reservation and qty.
 */
export async function confirmDispatch(
  shipmentId: string,
  input: ConfirmDispatchInput,
  actorId: string
): Promise<DispatchRecord> {
  const orgId = await getTenantOrgId();

  return runInTenantTransaction(orgId, async () => {
  const existing = await db.select().from(dispatches).where(and(eq(dispatches.orgId, orgId), eq(dispatches.shipmentId, shipmentId)));
  if (existing.length > 1) throw new DispatchError("Duplicate shipment dispatch history requires reconciliation.");
  const shipmentRow: TmsShipmentRow | null = await findById(tmsShipments, orgId, shipmentId);
  if (!shipmentRow) throw new DispatchError("Shipment nahi mila.");
  if (existing[0]) {
    if (shipmentRow.dispatchId !== existing[0].id || shipmentRow.orderId !== existing[0].orderId) {
      throw new DispatchError("Shipment dispatch links require reconciliation.");
    }
    return rowToDispatch(existing[0]);
  }
  if (shipmentRow.status !== "At_Loading_Dock") {
    throw new DispatchError(
      `Ye shipment "${shipmentRow.status}" hai — Dispatch sirf At_Loading_Dock shipment ke liye chalta hai.`
    );
  }
  if (shipmentRow.dispatchId) {
    throw new DispatchError("Is shipment ke liye pehle hi Dispatch confirm ho chuka hai.");
  }

  const order = await getOrder(shipmentRow.orderId);
  if (!order) throw new DispatchError("Order nahi mila.");

  const invoiceIssued = await isInvoiceIssued(orgId, order.id);
  if (!invoiceIssued) {
    throw new DispatchError(
      "Is order ka Invoice abhi Issued nahi hai — pehle Accounts se Invoice issue karwayein, phir Dispatch confirm karein."
    );
  }

  const itemRows = await loadShipmentItemRows(orgId, shipmentId);
  if (itemRows.length === 0) {
    throw new DispatchError("Is shipment me koi item nahi hai.");
  }

  const assignedTo = input.assignedTo?.trim() ?? "";
  if (!assignedTo) throw new DispatchError("Assignee chunna zaroori hai.");
  const assignee = await getUserById(assignedTo);
  if (!assignee) throw new DispatchError("Assignee user nahi mila.");

  const tatValue = round3(Number(input.tatValue));
  if (!(tatValue > 0)) throw new DispatchError("TAT value 0 se zyada honi chahiye.");
  if (!TAT_UNITS.includes(input.tatUnit)) throw new DispatchError("TAT unit galat hai.");

  const requests = itemRows.map(row => ({ sku: row.sku, quantity: Number(row.qty) }));
  // Central admission validates finite positive 3dp quantities and aggregates SKU demand.
  // Only this order's own unconsumed holds are excluded; all other holds remain protected.
  await assertStockAvailableMany(requests, { excludeOrderId: order.id });
  if (order.status !== "Ready_For_PDI") throw new DispatchError("Order is not dispatchable.");

  // Item master lookup (per distinct SKU) for the ledger row's Location — best-effort field,
  // never blocks the write (an item without a Location just gets a blank one, same as any
  // other movement in this codebase).
  const locationBySku = new Map<string, string>();
  for (const sku of new Set(itemRows.map((r) => r.sku))) {
    const item = await findItem(sku);
    if (item) locationBySku.set(sku, item.Location);
  }

  const tatDeadlineMs = await computeTatDeadline(assignee.User_ID, Date.now(), tatValue, input.tatUnit);

  const dispatchId = generateId("DSP");
  const gatePassAttachmentUrl = input.gatePassAttachmentUrl?.trim() ?? "";

  let committed: DispatchRow | null = null;
  let gatePassNo = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    gatePassNo = await allocateGatePassNumber(orgId);

    try {
    await db.transaction(async () => {
    // Retry scope must revalidate admission and construct its builders here.
    await assertStockAvailableMany(requests, { excludeOrderId: order.id });
    const freshShipment = await findById(tmsShipments, orgId, shipmentId);
    if (!freshShipment || freshShipment.dispatchId || freshShipment.status !== "At_Loading_Dock" || !await isInvoiceIssued(orgId, order.id)) throw new DispatchError("Shipment admission changed.");
    const dispatchInsert = db.insert(dispatches).values({
      id: dispatchId,
      orgId,
      orderId: order.id,
      shipmentId,
      gatePassNo,
      gatePassAttachmentUrl,
      assignedTo: assignee.User_ID,
      tatValue: String(tatValue),
      tatUnit: input.tatUnit,
      tatDeadline: new Date(tatDeadlineMs),
      status: "In_Transit" as const,
      createdBy: actorId,
    });

    const ledgerInsert = db.insert(stockLedger).values(
      itemRows.map((row) => ({
        id: generateId("TXN"),
        orgId,
        sku: row.sku,
        direction: "Out" as const,
        quantity: row.qty,
        uom: row.uom,
        source: "Dispatch" as const,
        referenceId: dispatchId,
        location: locationBySku.get(row.sku) ?? "",
        issuedTo: order.partyName,
        remark: `Dispatch ${gatePassNo} — Order ${order.id}, Shipment ${shipmentId}`,
        userId: actorId,
      }))
    );

    for (const row of itemRows) {
      const quantity = Number(row.qty);
      const updated = await db.update(orderItems)
        .set({ consumedQty: sql`${orderItems.consumedQty} + ${quantity}` })
        .where(and(
          eq(orderItems.orgId, orgId), eq(orderItems.orderId, order.id),
          eq(orderItems.lineNo, row.lineNo), eq(orderItems.sku, row.sku), eq(orderItems.uom, row.uom),
          sql`${orderItems.consumedQty} >= 0`,
          sql`${orderItems.reservedQty} < 'Infinity'::numeric`,
          sql`${orderItems.qty} < 'Infinity'::numeric`,
          sql`${orderItems.consumedQty} + ${quantity} <= ${orderItems.reservedQty}`,
          sql`${orderItems.consumedQty} + ${quantity} <= ${orderItems.qty}`,
        )).returning({ lineNo: orderItems.lineNo });
      if (updated.length !== 1) throw new DispatchError("Shipment exceeds its exact order line reservation or line identity is invalid.");
    }

    const claimed = await db.update(tmsShipments)
      .set({ dispatchId })
      .where(and(
        eq(tmsShipments.orgId, orgId), eq(tmsShipments.id, shipmentId),
        eq(tmsShipments.orderId, order.id), eq(tmsShipments.status, "At_Loading_Dock"),
        eq(tmsShipments.dispatchId, ""),
      )).returning({ id: tmsShipments.id });
    if (claimed.length !== 1) throw new DispatchError("Shipment claim failed.");

    const activityInsert = db.insert(dispatchActivities).values([
      {
        id: generateId("DAC"),
        orgId,
        orderId: order.id,
        kind: "Gate_Pass_Issued" as const,
        message: `Gate Pass ${gatePassNo} issue kiya gaya — Shipment ${shipmentId}, Dispatch ${dispatchId}.`,
        actorId,
      },
      {
        id: generateId("DAC"),
        orgId,
        orderId: order.id,
        kind: "Assigned" as const,
        message: `${assignee.Full_Name} ko is shipment ka Dispatch assign kiya gaya, TAT ${tatValue} ${input.tatUnit}.`,
        actorId,
      },
    ]);

      await db.batch([
        dispatchInsert,
        ledgerInsert,
        activityInsert,
      ]);
      committed = await findById(dispatches, orgId, dispatchId);
    });
      break;
    } catch (error) {
      if (isUniqueViolation(error, GATE_PASS_CONSTRAINT)) continue;
      throw error;
    }
  }

  if (!committed) {
    throw new DispatchError("Gate Pass number allocate nahi ho paya — dobara try karein.");
  }

  return rowToDispatch(committed);
  });
}

// ---------------------------------------------------------------------------
// Step 2 — Mark Dispatched: the assignee, or anyone holding DISPATCH_FMS.
// ---------------------------------------------------------------------------

export interface MarkDispatchedInput {
  proofOfDispatchUrl?: string;
}

export interface DispatchActor {
  userId: string;
  access: readonly ModuleAccessKey[];
}

/**
 * The assignee (whoever confirmDispatch() picked — not necessarily a DISPATCH_FMS holder
 * themselves, same as a Task's own assignee) or anyone holding DISPATCH_FMS may close this
 * out. Mirrors approveCreditHold()'s own "configured approver, or a broader override" shape
 * (src/lib/orders/orders.ts) rather than FMS step completion's strict single-assignee check
 * (src/lib/fms/engine.ts) — this module's own brief explicitly names both as allowed.
 */
export async function markDispatched(
  dispatchId: string,
  input: MarkDispatchedInput,
  actor: DispatchActor
): Promise<DispatchRecord> {
  const orgId = await getTenantOrgId();
  return runInTenantTransaction(orgId, async () => {
  const row = await findById(dispatches, orgId, dispatchId);
  if (!row) throw new DispatchError("Dispatch nahi mila.");
  if (row.status !== "In_Transit") {
    throw new DispatchError("Ye dispatch pehle se Dispatched hai.");
  }

  const authorized = actor.access.includes("DISPATCH_FMS") || actor.userId === row.assignedTo;
  if (!authorized) {
    throw new DispatchError("Sirf assigned user ya DISPATCH_FMS access wala hi ise Mark Dispatched kar sakta hai.");
  }

  const proofOfDispatchUrl = input.proofOfDispatchUrl?.trim() ?? "";
  await updateById(dispatches, orgId, dispatchId, {
    status: "Dispatched",
    dispatchedBy: actor.userId,
    dispatchedAt: new Date(),
    ...(proofOfDispatchUrl ? { proofOfDispatchUrl } : {}),
  });

  await logActivity(
    orgId,
    row.orderId,
    "Dispatched",
    `Shipment ${row.shipmentId} Dispatch ho gayi — Gate Pass ${row.gatePassNo}.${
      proofOfDispatchUrl ? " Proof of Dispatch attach kiya gaya." : ""
    }`,
    actor.userId
  );

  // Configured successor DB work is required: join this transaction, never use the
  // best-effort event dispatcher or defer DB creation to nondurable afterTenantCommit.
  const fullyDispatched = await isOrderFullyDispatched(row.orderId);
  if (fullyDispatched) {
    await logActivity(orgId, row.orderId, "Note", "Order ab poora Dispatch ho chuka hai.", "SYSTEM");
    for (const step of await listFmsTemplates()) {
      if (Number(step.Step_No) === 1 && step.Trigger_Event === "ORDER_FULLY_DISPATCHED" && step.Status === "Active") {
        await startFmsInstance({ templateId: step.Template_ID, contextRef: `ORDERS:${row.orderId}`, startedBy: "SYSTEM" });
      }
    }
  }

  const updated = await findById(dispatches, orgId, dispatchId);
  if (!updated) throw new DispatchError("Update ho gaya lekin dispatch load nahi ho paya.");
  return rowToDispatch(updated);
  });
}

// ---------------------------------------------------------------------------
// Step 3 — Mark Delivered: the customer-side close (added 2026-09-22, previously
// deferred). Same authorization shape as Mark Dispatched — the assignee, or anyone
// holding DISPATCH_FMS.
// ---------------------------------------------------------------------------

export interface MarkDeliveredInput {
  podAttachmentUrl?: string;
}

/**
 * Confirms the goods actually reached the customer — the driver/office marks it, the same
 * simple mechanism as markDispatched() above, deliberately not a customer-facing OTP/link
 * confirmation flow (see this table's own header comment in src/db/schema/dispatch.ts). Not
 * load-bearing like confirmDispatch() — the real stock_ledger "Out" already happened there;
 * this is a simple status-close action, same as markDispatched().
 *
 * Refuses unless the dispatch is currently Dispatched — not In_Transit (the transit itself
 * must be marked done first) and not already Delivered (no double-close).
 */
export async function markDelivered(
  dispatchId: string,
  input: MarkDeliveredInput,
  actor: DispatchActor
): Promise<DispatchRecord> {
  const orgId = await getTenantOrgId();
  return runInTenantTransaction(orgId, async () => {
  const row = await findById(dispatches, orgId, dispatchId);
  if (!row) throw new DispatchError("Dispatch nahi mila.");
  if (row.status !== "Dispatched") {
    throw new DispatchError(
      row.status === "Delivered"
        ? "Ye dispatch pehle se Delivered hai."
        : "Ye dispatch abhi Dispatched nahi hai — pehle Mark Dispatched karein."
    );
  }

  const authorized = actor.access.includes("DISPATCH_FMS") || actor.userId === row.assignedTo;
  if (!authorized) {
    throw new DispatchError("Sirf assigned user ya DISPATCH_FMS access wala hi ise Mark Delivered kar sakta hai.");
  }

  const podAttachmentUrl = input.podAttachmentUrl?.trim() ?? "";
  await updateById(dispatches, orgId, dispatchId, {
    status: "Delivered",
    deliveredBy: actor.userId,
    deliveredAt: new Date(),
    ...(podAttachmentUrl ? { podAttachmentUrl } : {}),
  });

  await logActivity(
    orgId,
    row.orderId,
    "Delivered",
    `Shipment ${row.shipmentId} Deliver ho gayi — Gate Pass ${row.gatePassNo}.${
      podAttachmentUrl ? " Proof of Delivery attach kiya gaya." : ""
    }`,
    actor.userId
  );

  const fullyDelivered = await isOrderFullyDelivered(row.orderId);
  if (fullyDelivered) {
    await logActivity(orgId, row.orderId, "Note", "Order ab poora Deliver ho chuka hai.", "SYSTEM");
    for (const step of await listFmsTemplates()) {
      if (Number(step.Step_No) === 1 && step.Trigger_Event === "ORDER_FULLY_DELIVERED" && step.Status === "Active") {
        await startFmsInstance({ templateId: step.Template_ID, contextRef: `ORDERS:${row.orderId}`, startedBy: "SYSTEM" });
      }
    }
  }

  const updated = await findById(dispatches, orgId, dispatchId);
  if (!updated) throw new DispatchError("Update ho gaya lekin dispatch load nahi ho paya.");
  return rowToDispatch(updated);
  });
}
