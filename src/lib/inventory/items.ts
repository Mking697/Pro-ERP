import {
  appendModuleRow,
  findModuleRow,
  getModuleRows,
  getModuleRowNumbers,
  recordToRow,
  updateModuleCells,
  updateModuleRow,
} from "@/lib/moduleSheets";
import { generateId } from "@/lib/id";
import { nowStamp } from "@/lib/timestamp";

const MODULE_KEY = "ITEMS";

export { ITEM_CATEGORIES, type ItemCategory } from "@/lib/inventory/constants";

/**
 * One row of the inventory master.
 *
 * Everything is stored as a string because that is what a sheet holds; the numeric
 * fields are parsed at the edge by `num()` rather than being trusted. A blank is a
 * genuine "not set yet", which is different from zero — `Lead_Time_Days` of 0 would
 * make the reorder point 0 and silently stop suggesting orders, so the UI has to be
 * able to tell those apart.
 */
export interface ItemRecord {
  SKU: string;
  Item_Name: string;
  Category: string;
  Size_Unit: string;
  UOM: string;
  Rate: string;
  ADC_Manual: string;
  Lead_Time_Days: string;
  Safety_Factor: string;
  MOQ: string;
  Max_Level: string;
  Location: string;
  Status: string;
  Created_At: string;
  Created_By: string;
}

/** Parses a sheet cell to a number, treating blank/garbage as "not set". */
export function num(value: string | undefined): number | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Same, but for places where a missing value should behave as zero. */
export function numOr0(value: string | undefined): number {
  return num(value) ?? 0;
}

/**
 * The planning fields the reorder maths depends on. An item missing any of these
 * cannot produce a meaningful reorder point, and the UI flags it instead of quietly
 * computing a number from blanks — which is exactly how the user's previous system
 * ended up never suggesting a reorder.
 */
export function missingPlanningFields(item: ItemRecord): string[] {
  const missing: string[] = [];
  if (num(item.Max_Level) === null) missing.push("Max Level");
  if (num(item.Lead_Time_Days) === null) missing.push("Lead Time");
  if (num(item.Safety_Factor) === null) missing.push("Safety Factor");
  return missing;
}

export async function listItems(): Promise<ItemRecord[]> {
  return getModuleRows<ItemRecord>(MODULE_KEY);
}

export async function listActiveItems(): Promise<ItemRecord[]> {
  const all = await listItems();
  return all.filter((i) => i.Status !== "Inactive");
}

export async function findItem(sku: string): Promise<ItemRecord | null> {
  const items = await listItems();
  return items.find((i) => i.SKU === sku) ?? null;
}

export interface CreateItemInput {
  sku?: string;
  itemName: string;
  category: string;
  sizeUnit?: string;
  uom: string;
  rate?: number | null;
  adcManual?: number | null;
  leadTimeDays?: number | null;
  safetyFactor?: number | null;
  moq?: number | null;
  maxLevel?: number | null;
  location?: string;
  createdBy: string;
}

function optional(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

export async function createItem(input: CreateItemInput): Promise<ItemRecord> {
  const items = await listItems();

  // A SKU is the join key for every ledger row, BOM line and indent — a duplicate
  // would silently merge two different materials' stock.
  const sku = (input.sku ?? "").trim() || generateId("SKU");
  if (items.some((i) => i.SKU.trim().toLowerCase() === sku.toLowerCase())) {
    throw new Error(`SKU "${sku}" pehle se maujood hai.`);
  }

  const record: ItemRecord = {
    SKU: sku,
    Item_Name: input.itemName.trim(),
    Category: input.category,
    Size_Unit: input.sizeUnit?.trim() ?? "",
    UOM: input.uom.trim(),
    Rate: optional(input.rate),
    ADC_Manual: optional(input.adcManual),
    Lead_Time_Days: optional(input.leadTimeDays),
    Safety_Factor: optional(input.safetyFactor),
    MOQ: optional(input.moq),
    Max_Level: optional(input.maxLevel),
    Location: input.location?.trim() ?? "",
    Status: "Active",
    Created_At: nowStamp(),
    Created_By: input.createdBy,
  };

  await appendModuleRow(MODULE_KEY, recordToRow(MODULE_KEY, record));
  return record;
}

export interface UpdateItemInput {
  itemName?: string;
  category?: string;
  sizeUnit?: string;
  uom?: string;
  rate?: number | null;
  adcManual?: number | null;
  leadTimeDays?: number | null;
  safetyFactor?: number | null;
  moq?: number | null;
  maxLevel?: number | null;
  location?: string;
  status?: string;
}

/**
 * Patches one item. Only the keys present in the patch are touched, so two people
 * editing different fields of the same item do not clobber each other's work as
 * easily — the whole row is still rewritten, but from freshly read values.
 */
export async function updateItem(
  sku: string,
  patch: UpdateItemInput
): Promise<ItemRecord> {
  const found = await findModuleRow<ItemRecord>(MODULE_KEY, 0, sku);
  if (!found) {
    throw new Error(`SKU "${sku}" nahi mila.`);
  }

  const current = found.record;
  const updated: ItemRecord = {
    ...current,
    Item_Name: patch.itemName ?? current.Item_Name,
    Category: patch.category ?? current.Category,
    Size_Unit: patch.sizeUnit ?? current.Size_Unit,
    UOM: patch.uom ?? current.UOM,
    Rate: patch.rate !== undefined ? optional(patch.rate) : current.Rate,
    ADC_Manual:
      patch.adcManual !== undefined ? optional(patch.adcManual) : current.ADC_Manual,
    Lead_Time_Days:
      patch.leadTimeDays !== undefined
        ? optional(patch.leadTimeDays)
        : current.Lead_Time_Days,
    Safety_Factor:
      patch.safetyFactor !== undefined
        ? optional(patch.safetyFactor)
        : current.Safety_Factor,
    MOQ: patch.moq !== undefined ? optional(patch.moq) : current.MOQ,
    Max_Level: patch.maxLevel !== undefined ? optional(patch.maxLevel) : current.Max_Level,
    Location: patch.location ?? current.Location,
    Status: patch.status ?? current.Status,
  };

  await updateModuleRow(MODULE_KEY, found.rowNumber, recordToRow(MODULE_KEY, updated));
  return updated;
}

/** The planning fields Bulk Setup edits. Nothing else on an item is touched there. */
export const PLANNING_FIELDS = [
  "ADC_Manual",
  "Lead_Time_Days",
  "Safety_Factor",
  "MOQ",
  "Max_Level",
] as const;
export type PlanningField = (typeof PLANNING_FIELDS)[number];

export type PlanningPatch = Partial<Record<PlanningField, number | null>>;

/**
 * Applies planning-field edits to many items in one API call.
 *
 * Bulk Setup exists because an item master runs to hundreds of rows and the reorder
 * maths is useless until Max Level, Lead Time and Safety Factor are filled — doing that
 * one dialog at a time is not realistic, and leaving it undone is what made the user's
 * previous system never suggest a reorder.
 *
 * Only the edited cells are written, so this cannot overwrite a name or category that
 * someone changed while the grid was open.
 */
export async function bulkUpdatePlanningFields(
  patches: { sku: string; fields: PlanningPatch }[]
): Promise<{ updated: number; unknownSkus: string[] }> {
  if (patches.length === 0) return { updated: 0, unknownSkus: [] };

  const rowNumbers = await getModuleRowNumbers(MODULE_KEY, 0);

  const rows: { rowNumber: number; fields: Record<string, string | number> }[] = [];
  const unknownSkus: string[] = [];

  for (const patch of patches) {
    const rowNumber = rowNumbers.get(patch.sku);
    if (rowNumber === undefined) {
      unknownSkus.push(patch.sku);
      continue;
    }

    const fields: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(patch.fields)) {
      // An empty string clears the field back to "not set", which the reorder maths
      // treats differently from zero — so null has to survive the round trip.
      fields[key] = value === null || value === undefined ? "" : value;
    }

    if (Object.keys(fields).length > 0) {
      rows.push({ rowNumber, fields });
    }
  }

  await updateModuleCells(MODULE_KEY, rows);
  return { updated: rows.length, unknownSkus };
}
