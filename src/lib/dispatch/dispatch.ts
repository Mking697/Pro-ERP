import type { InferSelectModel } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
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
import { db } from "@/db/client";
import { findById, insertRecord, listByOrg, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { getOrder, type OrderRecord } from "@/lib/orders/orders";
import { getUserById } from "@/lib/auth/users";
import { findItem } from "@/lib/inventory/items";
import { listLedger, onHandBySku } from "@/lib/inventory/ledger";
import { round3 } from "@/lib/inventory/allocation";
import { computeTatDeadline } from "@/lib/fms/calendar";
import type { FmsTatUnit } from "@/lib/fms/templates";
import { emitFmsEvent } from "@/lib/fms/engine";
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
    .where(and(eq(invoices.orgId, orgId), eq(invoices.orderId, orderId)))
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
    result.push({ ...record, partyName: order?.partyName ?? "", orderFullyDispatched });
  }
  return result;
}

export interface DispatchDetail {
  dispatch: DispatchRecord;
  order: OrderRecord;
  activities: DispatchActivityRecord[];
  orderFullyDispatched: boolean;
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

  return {
    dispatch,
    order,
    activities: activityRows.map(rowToActivity).reverse(),
    orderFullyDispatched,
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
function isUniqueViolation(error: unknown, constraintName: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; constraint?: unknown; message?: unknown };
  if (e.code !== "23505") return false;
  if (typeof e.constraint === "string") return e.constraint === constraintName;
  return typeof e.message === "string" && e.message.includes(constraintName);
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
 * calendar. See src/db/schema/dispatch.ts's own header comment for the two-step design and
 * CLAUDE.md's own note on why an FMS-style Ledger Movement Action is never best-effort — the
 * same reasoning applies here: this whole action must fail and leave nothing half-done if
 * the ledger write can't happen, so every read/validation runs first and the actual writes
 * (ledger + consumedQty + the dispatch row itself + the tms_shipments link + activity log)
 * all ride one `db.batch()` call (this driver's only real atomicity primitive — see
 * src/db/client.ts) rather than several separate awaited inserts that could leave a partial
 * result behind if a later one throws.
 *
 * The insufficient-stock check compares against real on-hand, not Free stock — this
 * quantity was already reserved (order_items.reservedQty) and is already excluded from every
 * OTHER order's own Free-stock view via orderReservedBySku(); checking against Free here
 * would double-subtract this order's own reservation and refuse a shipment that is actually
 * fine. Checking on-hand is a pure physical sanity check ("shouldn't normally happen since it
 * was already reserved, but must still be handled correctly" per this build's own brief).
 */
export async function confirmDispatch(
  shipmentId: string,
  input: ConfirmDispatchInput,
  actorId: string
): Promise<DispatchRecord> {
  const orgId = await getTenantOrgId();

  const shipmentRow: TmsShipmentRow | null = await findById(tmsShipments, orgId, shipmentId);
  if (!shipmentRow) throw new DispatchError("Shipment nahi mila.");
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

  // Insufficiency check against real on-hand — see this function's own header comment.
  const ledger = await listLedger();
  const onHand = onHandBySku(ledger);
  const used = new Map<string, number>();
  for (const row of itemRows) {
    const qty = Number(row.qty) || 0;
    if (!(qty > 0)) continue;
    const already = used.get(row.sku) ?? 0;
    const have = round3((onHand.get(row.sku) ?? 0) - already);
    if (qty > have) {
      throw new DispatchError(
        `SKU "${row.sku}" ke liye on-hand stock kam hai — sirf ${have} ${row.uom} hai, is shipment me ${qty} ${row.uom} chahiye.`
      );
    }
    used.set(row.sku, round3(already + qty));
  }

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

    const orderItemUpdates = itemRows.map((row) => {
      const currentLine = order.items.find((l) => l.lineNo === row.lineNo);
      const currentConsumed = currentLine?.consumedQty ?? 0;
      const newConsumed = round3(currentConsumed + (Number(row.qty) || 0));
      return db
        .update(orderItems)
        .set({ consumedQty: String(newConsumed) })
        .where(
          and(
            eq(orderItems.orgId, orgId),
            eq(orderItems.orderId, order.id),
            eq(orderItems.lineNo, row.lineNo)
          )
        );
    });

    const shipmentUpdate = db
      .update(tmsShipments)
      .set({ dispatchId })
      .where(and(eq(tmsShipments.orgId, orgId), eq(tmsShipments.id, shipmentId)));

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

    try {
      await db.batch([
        dispatchInsert,
        ledgerInsert,
        shipmentUpdate,
        activityInsert,
        ...orderItemUpdates,
      ]);
      committed = await findById(dispatches, orgId, dispatchId);
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

  // Best-effort, optional — mirrors emitFmsEvent's own chaining convention and TMS's own
  // ORDER_FULLY_SHIPPED follow-up (confirmLoadingDock()). Nothing downstream picks this up
  // today — this is genuinely the end of the whole 5-leg Sales chain — but the event is
  // still worth emitting for future notification/reporting use, same as CLAUDE.md notes.
  try {
    const fullyDispatched = await isOrderFullyDispatched(row.orderId);
    if (fullyDispatched) {
      await logActivity(orgId, row.orderId, "Note", "Order ab poora Dispatch ho chuka hai.", "SYSTEM");
      await emitFmsEvent("ORDER_FULLY_DISPATCHED", `ORDERS:${row.orderId}`);
    }
  } catch (error) {
    console.error(`[dispatch] fully-dispatched follow-up failed for order ${row.orderId}:`, error);
  }

  const updated = await findById(dispatches, orgId, dispatchId);
  if (!updated) throw new DispatchError("Update ho gaya lekin dispatch load nahi ho paya.");
  return rowToDispatch(updated);
}
