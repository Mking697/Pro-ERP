import type { InferSelectModel } from "drizzle-orm";
import { desc, eq } from "drizzle-orm";
import { indents } from "@/db/schema";
import { db } from "@/db/client";
import { findById, insertRecord, listByOrg, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { num, numOr0, type ItemRecord } from "@/lib/inventory/items";
import { recordMovement } from "@/lib/inventory/ledger";
import { parseStamp } from "@/lib/timestamp";

export const INDENT_STATUSES = [
  "Pending",
  "Approved",
  "Ordered",
  "Partially_Received",
  "Received",
  "Cancelled",
] as const;
export type IndentStatus = (typeof INDENT_STATUSES)[number];

/** Statuses where the quantity is promised but has not arrived — i.e. in transit. */
const OPEN_STATUSES: IndentStatus[] = ["Approved", "Ordered", "Partially_Received"];

export const INDENT_REASONS = ["Reorder", "Production_Shortage"] as const;
export type IndentReason = (typeof INDENT_REASONS)[number];

/**
 * Mirrors the pre-Postgres sheet row shape exactly (same field names, same PascalCase
 * casing, everything a string) even though the persistence underneath is now the
 * `indents` Postgres table. `indents` has a plain `id` primary key (unlike `items`/`bom`),
 * so it satisfies repo.ts's `IdentifiedTable` and every single-row read/write below goes
 * through the generic layer.
 */
export interface IndentRecord {
  Indent_ID: string;
  Timestamp: string;
  SKU: string;
  Item_Name: string;
  Suggested_Qty: string;
  Final_Qty: string;
  UOM: string;
  Reason: string;
  Linked_Plan_ID: string;
  Status: string;
  Requested_By: string;
  Approved_By: string;
  Approved_At: string;
  Expected_Date: string;
  Received_Qty: string;
  Received_At: string;
}

type IndentRow = InferSelectModel<typeof indents>;

function rowToRecord(row: IndentRow): IndentRecord {
  return {
    Indent_ID: row.id,
    Timestamp: row.timestamp.toISOString(),
    SKU: row.sku,
    Item_Name: row.itemName,
    Suggested_Qty: row.suggestedQty ?? "",
    Final_Qty: row.finalQty ?? "",
    UOM: row.uom,
    Reason: row.reason,
    Linked_Plan_ID: row.linkedPlanId,
    Status: row.status,
    Requested_By: row.requestedBy,
    Approved_By: row.approvedBy,
    Approved_At: row.approvedAt ? row.approvedAt.toISOString() : "",
    Expected_Date: row.expectedDate ? row.expectedDate.toISOString() : "",
    Received_Qty: row.receivedQty ?? "",
    Received_At: row.receivedAt ? row.receivedAt.toISOString() : "",
  };
}

/**
 * Newest first, for the Indents board — an explicit `ORDER BY timestamp DESC` rather than
 * relying on insertion order (which the old sheet-append order gave for free, but Postgres
 * makes no such guarantee for a plain unordered SELECT).
 */
export async function listIndents(): Promise<IndentRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(indents)
    .where(eq(indents.orgId, orgId))
    .orderBy(desc(indents.timestamp));
  return rows.map(rowToRecord);
}

/**
 * Quantity already promised by an approved or ordered indent but not yet received.
 *
 * This is what stops the system re-ordering something that is already on its way. A
 * `Pending` indent does not count — nobody has committed to buying it yet, so treating
 * it as incoming would suppress a genuine reorder while the approval sits unread.
 */
export async function inTransitBySku(): Promise<Map<string, number>> {
  const orgId = await getTenantOrgId();
  const rows = await listByOrg(indents, orgId);
  const transit = new Map<string, number>();

  for (const row of rows) {
    if (!row.sku || !OPEN_STATUSES.includes(row.status as IndentStatus)) continue;
    const outstanding = numOr0(row.finalQty) - numOr0(row.receivedQty);
    if (outstanding > 0) {
      transit.set(row.sku, (transit.get(row.sku) ?? 0) + outstanding);
    }
  }

  return transit;
}

/**
 * How much to order.
 *
 * Covers the shortage that triggered this *and* tops the item back up to its Max Level,
 * never dipping below the supplier's minimum. Ordering only the shortage leaves the item
 * back at its reorder point immediately; ordering only up to Max Level leaves a
 * production shortage unfilled. Both matter, so it takes whichever is larger.
 *
 * Rounded up to a whole multiple of MOQ because a supplier will not split one.
 */
export function suggestIndentQty(
  item: ItemRecord,
  projected: number,
  shortage = 0
): number {
  const maxLevel = num(item.Max_Level);
  const moq = num(item.MOQ);

  const topUp = maxLevel === null ? 0 : Math.max(maxLevel - projected, 0);
  const base = Math.max(shortage, topUp, moq ?? 0);

  if (base <= 0) return 0;
  if (!moq || moq <= 0) return round3(base);

  return round3(Math.ceil(base / moq) * moq);
}

/** Quantities can be fractional; three places is enough for kg/m without float noise. */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface CreateIndentInput {
  sku: string;
  itemName: string;
  suggestedQty: number;
  finalQty: number;
  uom: string;
  reason: IndentReason;
  linkedPlanId?: string;
  expectedDate?: string;
  requestedBy: string;
}

export async function createIndent(input: CreateIndentInput): Promise<IndentRecord> {
  if (!(input.finalQty > 0)) {
    throw new Error("Indent quantity 0 se zyada honi chahiye.");
  }

  const orgId = await getTenantOrgId();
  const row = await insertRecord(indents, {
    id: generateId("IND"),
    orgId,
    sku: input.sku,
    itemName: input.itemName,
    suggestedQty: String(input.suggestedQty),
    finalQty: String(input.finalQty),
    uom: input.uom,
    reason: input.reason,
    linkedPlanId: input.linkedPlanId ?? "",
    status: "Pending",
    requestedBy: input.requestedBy,
    approvedBy: "",
    expectedDate: input.expectedDate ? parseStamp(input.expectedDate) : null,
    receivedQty: null,
  });

  return rowToRecord(row);
}

async function loadIndent(orgId: string, indentId: string): Promise<IndentRow> {
  const found = await findById(indents, orgId, indentId);
  if (!found) throw new Error("Indent nahi mila.");
  return found;
}

export async function approveIndent(
  indentId: string,
  approvedBy: string,
  finalQty?: number
): Promise<IndentRecord> {
  const orgId = await getTenantOrgId();
  const found = await loadIndent(orgId, indentId);
  if (found.status !== "Pending") {
    throw new Error(`Ye indent pehle se "${found.status}" hai.`);
  }
  if (finalQty !== undefined && !(finalQty > 0)) {
    throw new Error("Quantity 0 se zyada honi chahiye.");
  }

  const updated = await updateById(indents, orgId, indentId, {
    status: "Approved",
    approvedBy,
    approvedAt: new Date(),
    finalQty: finalQty !== undefined ? String(finalQty) : found.finalQty,
  });
  if (!updated) throw new Error("Indent nahi mila.");
  return rowToRecord(updated);
}

export async function cancelIndent(indentId: string): Promise<IndentRecord> {
  const orgId = await getTenantOrgId();
  const found = await loadIndent(orgId, indentId);
  if (found.status === "Received") {
    throw new Error("Received indent cancel nahi ho sakta.");
  }

  const updated = await updateById(indents, orgId, indentId, { status: "Cancelled" });
  if (!updated) throw new Error("Indent nahi mila.");
  return rowToRecord(updated);
}

export class IndentReceiptError extends Error {}

/**
 * Records material arriving against an indent.
 *
 * Writes the stock In itself, so receiving is one action rather than "mark received,
 * then remember to also add the stock" — the step people forget, which is how a ledger
 * drifts away from the shelf.
 *
 * Partial receipts accumulate: the indent stays open at `Partially_Received` until the
 * full quantity has arrived, and in-transit shrinks by exactly what was received.
 */
export async function receiveIndent(
  indentId: string,
  receivedNow: number,
  userId: string,
  location?: string
): Promise<IndentRecord> {
  if (!(receivedNow > 0)) {
    throw new IndentReceiptError("Received quantity 0 se zyada honi chahiye.");
  }

  const orgId = await getTenantOrgId();
  const indent = await loadIndent(orgId, indentId);

  if (!OPEN_STATUSES.includes(indent.status as IndentStatus)) {
    throw new IndentReceiptError(
      `Is indent par receive nahi kar sakte — abhi "${indent.status}" hai. Pehle approve karein.`
    );
  }

  const ordered = numOr0(indent.finalQty);
  const already = numOr0(indent.receivedQty);
  const outstanding = ordered - already;

  if (receivedNow > outstanding) {
    throw new IndentReceiptError(
      `Sirf ${round3(outstanding)} ${indent.uom} bacha hua hai, aur aap ${receivedNow} receive kar rahe hain.`
    );
  }

  const total = round3(already + receivedNow);

  // Stock first: if the ledger write fails the indent stays open, which is recoverable.
  // The reverse order would leave stock added against an indent that still looks unfilled.
  await recordMovement({
    sku: indent.sku,
    direction: "In",
    quantity: receivedNow,
    uom: indent.uom,
    source: "Indent_Receipt",
    referenceId: indent.id,
    location,
    remark: `Indent receipt — ${indent.reason}`,
    userId,
  });

  const updated = await updateById(indents, orgId, indentId, {
    receivedQty: String(total),
    receivedAt: new Date(),
    status: total >= ordered ? "Received" : "Partially_Received",
  });
  if (!updated) throw new IndentReceiptError("Indent nahi mila.");
  return rowToRecord(updated);
}
