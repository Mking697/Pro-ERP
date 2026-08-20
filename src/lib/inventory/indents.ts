import {
  appendModuleRow,
  findModuleRow,
  getModuleRows,
  recordToRow,
  tryModule,
  updateModuleRow,
} from "@/lib/moduleSheets";
import { generateId } from "@/lib/id";
import { num, numOr0, type ItemRecord } from "@/lib/inventory/items";
import { recordMovement } from "@/lib/inventory/ledger";

const MODULE_KEY = "INDENTS";

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

export async function listIndents(): Promise<IndentRecord[]> {
  const rows = await getModuleRows<IndentRecord>(MODULE_KEY);
  return rows.reverse();
}

/**
 * Quantity already promised by an approved or ordered indent but not yet received.
 *
 * This is what stops the system re-ordering something that is already on its way. A
 * `Pending` indent does not count — nobody has committed to buying it yet, so treating
 * it as incoming would suppress a genuine reorder while the approval sits unread.
 *
 * Returns an empty map when the Indents sheet is not connected, so inventory keeps
 * working for an organization that has not set up purchasing.
 */
export async function inTransitBySku(): Promise<Map<string, number>> {
  const indents = await tryModule(() => getModuleRows<IndentRecord>(MODULE_KEY));
  const transit = new Map<string, number>();

  for (const row of indents ?? []) {
    if (!row.SKU || !OPEN_STATUSES.includes(row.Status as IndentStatus)) continue;
    const outstanding = numOr0(row.Final_Qty) - numOr0(row.Received_Qty);
    if (outstanding > 0) {
      transit.set(row.SKU, (transit.get(row.SKU) ?? 0) + outstanding);
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

  const record: IndentRecord = {
    Indent_ID: generateId("IND"),
    Timestamp: new Date().toISOString(),
    SKU: input.sku,
    Item_Name: input.itemName,
    Suggested_Qty: String(input.suggestedQty),
    Final_Qty: String(input.finalQty),
    UOM: input.uom,
    Reason: input.reason,
    Linked_Plan_ID: input.linkedPlanId ?? "",
    Status: "Pending",
    Requested_By: input.requestedBy,
    Approved_By: "",
    Approved_At: "",
    Expected_Date: input.expectedDate ?? "",
    Received_Qty: "",
    Received_At: "",
  };

  await appendModuleRow(MODULE_KEY, recordToRow(MODULE_KEY, record));
  return record;
}

async function loadIndent(indentId: string) {
  const found = await findModuleRow<IndentRecord>(MODULE_KEY, 0, indentId);
  if (!found) throw new Error("Indent nahi mila.");
  return found;
}

export async function approveIndent(
  indentId: string,
  approvedBy: string,
  finalQty?: number
): Promise<IndentRecord> {
  const found = await loadIndent(indentId);
  if (found.record.Status !== "Pending") {
    throw new Error(`Ye indent pehle se "${found.record.Status}" hai.`);
  }
  if (finalQty !== undefined && !(finalQty > 0)) {
    throw new Error("Quantity 0 se zyada honi chahiye.");
  }

  const updated: IndentRecord = {
    ...found.record,
    Status: "Approved",
    Approved_By: approvedBy,
    Approved_At: new Date().toISOString(),
    Final_Qty: finalQty !== undefined ? String(finalQty) : found.record.Final_Qty,
  };

  await updateModuleRow(MODULE_KEY, found.rowNumber, recordToRow(MODULE_KEY, updated));
  return updated;
}

export async function cancelIndent(indentId: string): Promise<IndentRecord> {
  const found = await loadIndent(indentId);
  if (found.record.Status === "Received") {
    throw new Error("Received indent cancel nahi ho sakta.");
  }

  const updated: IndentRecord = { ...found.record, Status: "Cancelled" };
  await updateModuleRow(MODULE_KEY, found.rowNumber, recordToRow(MODULE_KEY, updated));
  return updated;
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

  const found = await loadIndent(indentId);
  const indent = found.record;

  if (!OPEN_STATUSES.includes(indent.Status as IndentStatus)) {
    throw new IndentReceiptError(
      `Is indent par receive nahi kar sakte — abhi "${indent.Status}" hai. Pehle approve karein.`
    );
  }

  const ordered = numOr0(indent.Final_Qty);
  const already = numOr0(indent.Received_Qty);
  const outstanding = ordered - already;

  if (receivedNow > outstanding) {
    throw new IndentReceiptError(
      `Sirf ${round3(outstanding)} ${indent.UOM} bacha hua hai, aur aap ${receivedNow} receive kar rahe hain.`
    );
  }

  const total = round3(already + receivedNow);
  const now = new Date().toISOString();

  const updated: IndentRecord = {
    ...indent,
    Received_Qty: String(total),
    Received_At: now,
    Status: total >= ordered ? "Received" : "Partially_Received",
  };

  // Stock first: if the ledger write fails the indent stays open, which is recoverable.
  // The reverse order would leave stock added against an indent that still looks unfilled.
  await recordMovement({
    sku: indent.SKU,
    direction: "In",
    quantity: receivedNow,
    uom: indent.UOM,
    source: "Indent_Receipt",
    referenceId: indent.Indent_ID,
    location,
    remark: `Indent receipt — ${indent.Reason}`,
    userId,
  });

  await updateModuleRow(MODULE_KEY, found.rowNumber, recordToRow(MODULE_KEY, updated));
  return updated;
}
