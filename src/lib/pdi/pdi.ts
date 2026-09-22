import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq } from "drizzle-orm";
import { orders as ordersTable, pdiActivities, pdiInspections } from "@/db/schema";
import { db } from "@/db/client";
import { findById, insertRecord, listByOrg, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { getOrder, type OrderRecord } from "@/lib/orders/orders";
import { emitFmsEvent } from "@/lib/fms/engine";

/**
 * PDI (Pre-Dispatch Inspection) — leg 3 of the Sales chain (Lead -> Order -> PDI -> TMS ->
 * Dispatch, TMS/Dispatch not built yet). See src/db/schema/pdi.ts's own header comment for
 * the full design reasoning. Built as its own hardcoded flow, not a generic FMS Template,
 * matching Purchase FMS/Order FMS's precedent (see CLAUDE.md).
 *
 * This file statically imports orders.ts (for getOrder()/OrderRecord — PDI has no stock/
 * money logic of its own, it only ever reads an order's own items live). orders.ts must
 * therefore never statically import this file back — its own recheckShortfallForSku()
 * reaches into this file's noteStockAvailable() via a dynamic import() instead, exactly
 * like plans.ts's own hasFmsLine() breaks its circular import with fms/engine.ts.
 */

export class PdiError extends Error {}

export type PdiStatus = "Pending" | "Passed";

export type PdiActivityKind =
  | "Note"
  | "Waiting_Stock"
  | "Stock_Available"
  | "Inspected_Pass"
  | "Inspected_Fail";

export interface PdiActivityRecord {
  id: string;
  pdiId: string;
  kind: PdiActivityKind;
  message: string;
  attachmentUrl: string;
  actorId: string;
  createdAt: string;
}

export interface PdiInspectionRecord {
  id: string;
  orderId: string;
  status: PdiStatus;
  dueAt: string;
  attachmentUrl: string;
  passedBy: string;
  passedAt: string;
  createdAt: string;
  /** The order this inspection belongs to, full detail (party, items, reserved/shortage
   * per line) — PDI keeps none of this itself, it's read live off Order FMS's own tables
   * every time. */
  order: OrderRecord;
  /** Live-derived, never stored — true when any of the order's own lines still has
   * shortageQty > 0. Display-only: it decides what the UI shows and whether the Inspect
   * action is even offered, it is not a separate status. */
  waitingForStock: boolean;
}

type PdiRow = InferSelectModel<typeof pdiInspections>;
type PdiActivityRow = InferSelectModel<typeof pdiActivities>;

function rowToActivity(row: PdiActivityRow): PdiActivityRecord {
  return {
    id: row.id,
    pdiId: row.pdiId,
    kind: row.kind,
    message: row.message,
    attachmentUrl: row.attachmentUrl,
    actorId: row.actorId,
    createdAt: row.createdAt.toISOString(),
  };
}

async function rowToInspection(row: PdiRow): Promise<PdiInspectionRecord | null> {
  const order = await getOrder(row.orderId);
  if (!order) return null;
  const waitingForStock = order.items.some((l) => l.shortageQty > 0);
  return {
    id: row.id,
    orderId: row.orderId,
    status: row.status,
    dueAt: row.dueAt ? row.dueAt.toISOString() : "",
    attachmentUrl: row.attachmentUrl,
    passedBy: row.passedBy,
    passedAt: row.passedAt ? row.passedAt.toISOString() : "",
    createdAt: row.createdAt.toISOString(),
    order,
    waitingForStock,
  };
}

async function logActivity(
  orgId: string,
  pdiId: string,
  kind: PdiActivityKind,
  message: string,
  actorId: string,
  attachmentUrl = ""
): Promise<void> {
  await insertRecord(pdiActivities, {
    id: generateId("PDA"),
    orgId,
    pdiId,
    kind,
    message,
    attachmentUrl,
    actorId,
  });
}

// ---------------------------------------------------------------------------
// Intake — every Ready_For_PDI order not yet punched into an inspection
// ---------------------------------------------------------------------------

/** Mirrors Order FMS's own listIntakeCandidates()/Purchase's listPurchaseCandidates() —
 * a cheap scan, no push/event needed to populate this queue. */
export async function listIntakeCandidates(): Promise<OrderRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.orgId, orgId),
        eq(ordersTable.status, "Ready_For_PDI"),
        eq(ordersTable.pdiId, "")
      )
    );

  const result: OrderRecord[] = [];
  for (const row of rows) {
    const order = await getOrder(row.id);
    if (order) result.push(order);
  }
  return result.sort((a, b) => (a.dispatchCommitDate < b.dispatchCommitDate ? -1 : 1));
}

/**
 * Punches a Ready_For_PDI order into PDI: creates the pdi_inspections row (Pending,
 * dueAt = the order's own dispatchCommitDate minus one calendar day — a sales deadline,
 * not an FMS TAT, so no working-hours calendar is involved) and sets orders.pdiId so it
 * drops out of the intake queue.
 */
export async function punchOrderIntoPdi(orderId: string, actorId: string): Promise<PdiInspectionRecord> {
  const orgId = await getTenantOrgId();
  const order = await findById(ordersTable, orgId, orderId);
  if (!order) throw new PdiError("Order nahi mila.");
  if (order.status !== "Ready_For_PDI") {
    throw new PdiError(`Ye order "${order.status}" hai — PDI sirf "Ready For PDI" order ke liye ban sakta hai.`);
  }
  if (order.pdiId) {
    throw new PdiError("Is order ke liye pehle hi ek PDI inspection ban chuki hai.");
  }
  if (!order.dispatchCommitDate) {
    throw new PdiError("Order ka Dispatch Commit Date set nahi hai — PDI due date nahi nikal sakta.");
  }

  const dueAt = new Date(order.dispatchCommitDate.getTime() - 24 * 60 * 60 * 1000);

  const pdiId = generateId("PDI");
  await insertRecord(pdiInspections, {
    id: pdiId,
    orgId,
    orderId,
    status: "Pending",
    dueAt,
  });
  await updateById(ordersTable, orgId, orderId, { pdiId });

  await logActivity(orgId, pdiId, "Note", `Order ${orderId} PDI me punch kiya gaya.`, actorId);

  const created = await getInspection(pdiId);
  if (!created) throw new PdiError("PDI ban gayi lekin load nahi ho payi.");

  if (created.waitingForStock) {
    await logActivity(
      orgId,
      pdiId,
      "Waiting_Stock",
      "Order ke kuch line abhi stock ka wait kar rahe hain — jab tak shortage clear na ho, inspect nahi ho sakta.",
      "SYSTEM"
    );
  }

  return created;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getInspection(pdiId: string): Promise<PdiInspectionRecord | null> {
  const orgId = await getTenantOrgId();
  const row = await findById(pdiInspections, orgId, pdiId);
  if (!row) return null;
  return rowToInspection(row);
}

export async function listInspections(status?: PdiStatus): Promise<PdiInspectionRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = status
    ? await db
        .select()
        .from(pdiInspections)
        .where(and(eq(pdiInspections.orgId, orgId), eq(pdiInspections.status, status)))
    : await listByOrg(pdiInspections, orgId);

  const result: PdiInspectionRecord[] = [];
  for (const row of rows) {
    const rec = await rowToInspection(row);
    if (rec) result.push(rec);
  }
  return result.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function listActivities(pdiId: string): Promise<PdiActivityRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(pdiActivities)
    .where(and(eq(pdiActivities.orgId, orgId), eq(pdiActivities.pdiId, pdiId)))
    .orderBy(desc(pdiActivities.createdAt));
  return rows.map(rowToActivity);
}

// ---------------------------------------------------------------------------
// The inspection action — Pass or Fail
// ---------------------------------------------------------------------------

export interface InspectInput {
  result: "Pass" | "Fail";
  remark?: string;
  attachmentUrl?: string;
}

/**
 * Records one inspection attempt. A Fail leaves status at 'Pending' — it loops, the same
 * row gets re-inspected later, nothing new is created. A Pass sets status = 'Passed' and
 * best-effort emits ORDER_PDI_PASSED, the seam a future TMS module picks up from (same
 * pattern as LEAD_ORDER_CONFIRMED/ORDER_READY_FOR_PDI).
 */
export async function inspect(
  pdiId: string,
  input: InspectInput,
  actorId: string
): Promise<PdiInspectionRecord> {
  const orgId = await getTenantOrgId();
  const row = await findById(pdiInspections, orgId, pdiId);
  if (!row) throw new PdiError("PDI inspection nahi mili.");
  if (row.status !== "Pending") {
    throw new PdiError(`Ye inspection "${row.status}" hai — sirf Pending par inspect kiya ja sakta hai.`);
  }

  const order = await getOrder(row.orderId);
  if (!order) throw new PdiError("Order nahi mila.");
  const waiting = order.items.some((l) => l.shortageQty > 0);
  if (waiting) {
    throw new PdiError("Ye order abhi stock ka wait kar raha hai — jab tak shortage clear na ho, inspect nahi ho sakta.");
  }

  const attachmentUrl = input.attachmentUrl?.trim() ?? "";
  const remark = input.remark?.trim() ?? "";
  const latestAttachment = attachmentUrl || row.attachmentUrl;

  if (input.result === "Pass") {
    await updateById(pdiInspections, orgId, pdiId, {
      status: "Passed",
      passedBy: actorId,
      passedAt: new Date(),
      attachmentUrl: latestAttachment,
    });
    await logActivity(
      orgId,
      pdiId,
      "Inspected_Pass",
      remark ? `Inspection Pass ho gayi — ${remark}` : "Inspection Pass ho gayi.",
      actorId,
      attachmentUrl
    );

    try {
      await emitFmsEvent("ORDER_PDI_PASSED", `ORDERS:${row.orderId}`);
    } catch (error) {
      console.error(`[pdi] emitFmsEvent(ORDER_PDI_PASSED) failed for ${pdiId}:`, error);
    }
  } else {
    await updateById(pdiInspections, orgId, pdiId, { attachmentUrl: latestAttachment });
    await logActivity(
      orgId,
      pdiId,
      "Inspected_Fail",
      remark ? `Inspection Fail ho gayi — ${remark}` : "Inspection Fail ho gayi — dobara inspect karna hoga.",
      actorId,
      attachmentUrl
    );
  }

  const updated = await getInspection(pdiId);
  if (!updated) throw new PdiError("Inspection update ho gayi lekin load nahi ho payi.");
  return updated;
}

// ---------------------------------------------------------------------------
// Called (dynamically) from orders.ts's own recheckShortfallForSku() — never imported
// statically from there, to avoid a circular import with this file's own static import of
// orders.ts above.
// ---------------------------------------------------------------------------

/** Best-effort note on this PDI's own timeline that a shortage it was waiting on has
 * cleared. Never throws on its own account — the caller (orders.ts) wraps it in try/catch
 * as an extra layer of safety since it's invoked from deep inside a stock-write hot path,
 * but this function's own DB calls are the only way it could fail. */
export async function noteStockAvailable(pdiId: string, message: string): Promise<void> {
  const orgId = await getTenantOrgId();
  const row = await findById(pdiInspections, orgId, pdiId);
  if (!row || row.status !== "Pending") return;
  await logActivity(orgId, pdiId, "Stock_Available", message, "SYSTEM");
}
