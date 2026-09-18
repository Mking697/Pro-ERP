import type { InferSelectModel } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import { items } from "@/db/schema";
import { db } from "@/db/client";
import { listByOrg, insertRecord } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { ITEM_CATEGORIES, type ItemCategory } from "@/lib/inventory/constants";

export { ITEM_CATEGORIES, type ItemCategory } from "@/lib/inventory/constants";

/**
 * One row of the inventory master.
 *
 * Mirrors the pre-Postgres sheet row shape exactly (same field names, same PascalCase
 * casing, everything a string) even though the persistence underneath is now the `items`
 * Postgres table — the goal is zero changes at the API routes and every inventory
 * frontend, which all read `.SKU`, `.Item_Name`, etc. off this type today.
 *
 * Everything is still a string at this boundary: a blank is a genuine "not set yet",
 * which is different from zero — `Lead_Time_Days` of 0 would make the reorder point 0
 * and silently stop suggesting orders, so the UI has to be able to tell those apart.
 *
 * `items`' primary key column is named `sku`, not `id` — per repo.ts's `IdentifiedTable`
 * doc comment this does NOT satisfy the generic findById/updateById/deleteById layer, so
 * every SKU-keyed read/write below is a direct, bespoke Drizzle query instead.
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

/** Parses a stored value to a number, treating blank/garbage/null as "not set". */
export function num(value: string | null | undefined): number | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Same, but for places where a missing value should behave as zero. */
export function numOr0(value: string | null | undefined): number {
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

type ItemRow = InferSelectModel<typeof items>;

function rowToRecord(row: ItemRow): ItemRecord {
  return {
    SKU: row.sku,
    Item_Name: row.itemName,
    Category: row.category,
    Size_Unit: row.sizeUnit,
    UOM: row.uom,
    Rate: row.rate ?? "",
    ADC_Manual: row.adcManual ?? "",
    Lead_Time_Days: row.leadTimeDays === null ? "" : String(row.leadTimeDays),
    Safety_Factor: row.safetyFactor ?? "",
    MOQ: row.moq ?? "",
    Max_Level: row.maxLevel ?? "",
    Location: row.location,
    Status: row.status,
    Created_At: row.createdAt.toISOString(),
    Created_By: row.createdBy,
  };
}

/** number|null|undefined -> a `numeric` column's insert/update value. */
function numericCol(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

export async function listItems(): Promise<ItemRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await listByOrg(items, orgId);
  return rows.map(rowToRecord);
}

export async function listActiveItems(): Promise<ItemRecord[]> {
  const all = await listItems();
  return all.filter((i) => i.Status !== "Inactive");
}

export async function findItem(sku: string): Promise<ItemRecord | null> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(items)
    .where(and(eq(items.orgId, orgId), eq(items.sku, sku)))
    .limit(1);
  return rows[0] ? rowToRecord(rows[0]) : null;
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
  const orgId = await getTenantOrgId();
  const existing = await listItems();

  // A SKU is the join key for every ledger row, BOM line and indent — a duplicate
  // would silently merge two different materials' stock.
  const sku = (input.sku ?? "").trim() || generateId("SKU");
  if (existing.some((i) => i.SKU.trim().toLowerCase() === sku.toLowerCase())) {
    throw new Error(`SKU "${sku}" pehle se maujood hai.`);
  }

  const row = await insertRecord(items, {
    sku,
    orgId,
    itemName: input.itemName.trim(),
    category: input.category,
    sizeUnit: input.sizeUnit?.trim() ?? "",
    uom: input.uom.trim(),
    rate: numericCol(input.rate),
    adcManual: numericCol(input.adcManual),
    leadTimeDays: input.leadTimeDays ?? null,
    safetyFactor: numericCol(input.safetyFactor),
    moq: numericCol(input.moq),
    maxLevel: numericCol(input.maxLevel),
    location: input.location?.trim() ?? "",
    status: "Active",
    createdBy: input.createdBy,
  });

  return rowToRecord(row);
}

export interface BulkCreateRowInput {
  /** 1-based row number in the uploaded file (header row is 1), only for error messages. */
  row: number;
  sku?: string;
  itemName: string;
  category: string;
  sizeUnit?: string;
  uom: string;
  rate?: number | null;
  leadTimeDays?: number | null;
  safetyFactor?: number | null;
  moq?: number | null;
  maxLevel?: number | null;
  location?: string;
  /** Written as one "Opening" ledger entry per item after all items are created — see
   * the API route, which is what actually calls recordMovementsBulk() (items.ts never
   * imports the ledger, to avoid a circular import: ledger.ts already imports items.ts
   * for ItemRecord/num/numOr0). */
  openingStock?: number | null;
}

export interface BulkCreateResult {
  /** Paired with the input row number so a caller can look up e.g. its openingStock
   * value (auto-generated SKUs mean the item's own SKU can't be used for that lookup). */
  created: { row: number; item: ItemRecord }[];
  errors: { row: number; message: string }[];
}

/**
 * Creates many items from one uploaded spreadsheet in a single insert.
 *
 * Reads the existing item list once (not once per row) and tracks SKUs — both already in
 * Postgres and already claimed earlier in this same file — in one in-memory set, so two
 * rows of the same upload can't collide with each other the way a duplicate-only-against-
 * the-table check would miss. A bad row (no name, an unknown category, a SKU already
 * taken) is skipped and reported rather than failing the whole import — a 400-row upload
 * with one typo should still create the other 399, the same way the rest of this app
 * prefers a partial, reported result (see bulkUpdatePlanningFields's unknownSkus) over an
 * all-or-nothing failure.
 */
export async function createItemsBulk(
  inputs: BulkCreateRowInput[],
  createdBy: string
): Promise<BulkCreateResult> {
  const orgId = await getTenantOrgId();
  const existing = await listItems();
  const usedSkus = new Set(existing.map((i) => i.SKU.trim().toLowerCase()));

  const created: { row: number; item: ItemRecord }[] = [];
  const errors: { row: number; message: string }[] = [];
  const rows: (typeof items.$inferInsert)[] = [];

  for (const input of inputs) {
    if (!input.itemName.trim()) {
      errors.push({ row: input.row, message: "Item ka naam zaroori hai." });
      continue;
    }
    if (!input.uom.trim()) {
      errors.push({ row: input.row, message: "UOM zaroori hai." });
      continue;
    }
    if (!ITEM_CATEGORIES.includes(input.category as ItemCategory)) {
      errors.push({
        row: input.row,
        message: `Category "${input.category}" invalid hai — ${ITEM_CATEGORIES.join(", ")} me se ek honi chahiye.`,
      });
      continue;
    }

    let sku = (input.sku ?? "").trim();
    if (!sku) {
      do {
        sku = generateId("SKU");
      } while (usedSkus.has(sku.toLowerCase()));
    } else if (usedSkus.has(sku.toLowerCase())) {
      errors.push({ row: input.row, message: `SKU "${sku}" pehle se maujood hai.` });
      continue;
    }
    usedSkus.add(sku.toLowerCase());

    const record: ItemRecord = {
      SKU: sku,
      Item_Name: input.itemName.trim(),
      Category: input.category,
      Size_Unit: input.sizeUnit?.trim() ?? "",
      UOM: input.uom.trim(),
      Rate: optional(input.rate),
      ADC_Manual: "",
      Lead_Time_Days: optional(input.leadTimeDays),
      Safety_Factor: optional(input.safetyFactor),
      MOQ: optional(input.moq),
      Max_Level: optional(input.maxLevel),
      Location: input.location?.trim() ?? "",
      Status: "Active",
      Created_At: new Date().toISOString(),
      Created_By: createdBy,
    };

    created.push({ row: input.row, item: record });
    rows.push({
      sku,
      orgId,
      itemName: record.Item_Name,
      category: record.Category,
      sizeUnit: record.Size_Unit,
      uom: record.UOM,
      rate: numericCol(input.rate),
      adcManual: null,
      leadTimeDays: input.leadTimeDays ?? null,
      safetyFactor: numericCol(input.safetyFactor),
      moq: numericCol(input.moq),
      maxLevel: numericCol(input.maxLevel),
      location: record.Location,
      status: "Active",
      createdBy,
    });
  }

  if (rows.length > 0) {
    await db.insert(items).values(rows);
  }

  return { created, errors };
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
 * Patches one item. Only the keys present in the patch are touched — Postgres's UPDATE
 * still rewrites the whole row under the hood, but from freshly read values, same as the
 * pre-Postgres "only the edited cells" behaviour it preserves at the field level.
 */
export async function updateItem(
  sku: string,
  patch: UpdateItemInput
): Promise<ItemRecord> {
  const orgId = await getTenantOrgId();
  const current = await findItem(sku);
  if (!current) {
    throw new Error(`SKU "${sku}" nahi mila.`);
  }

  const [row] = await db
    .update(items)
    .set({
      itemName: patch.itemName ?? current.Item_Name,
      category: patch.category ?? current.Category,
      sizeUnit: patch.sizeUnit ?? current.Size_Unit,
      uom: patch.uom ?? current.UOM,
      rate: patch.rate !== undefined ? numericCol(patch.rate) : current.Rate || null,
      adcManual:
        patch.adcManual !== undefined ? numericCol(patch.adcManual) : current.ADC_Manual || null,
      leadTimeDays:
        patch.leadTimeDays !== undefined ? patch.leadTimeDays : num(current.Lead_Time_Days),
      safetyFactor:
        patch.safetyFactor !== undefined
          ? numericCol(patch.safetyFactor)
          : current.Safety_Factor || null,
      moq: patch.moq !== undefined ? numericCol(patch.moq) : current.MOQ || null,
      maxLevel:
        patch.maxLevel !== undefined ? numericCol(patch.maxLevel) : current.Max_Level || null,
      location: patch.location ?? current.Location,
      status: (patch.status ?? current.Status) as "Active" | "Inactive",
    })
    .where(and(eq(items.orgId, orgId), eq(items.sku, sku)))
    .returning();

  if (!row) {
    throw new Error(`SKU "${sku}" nahi mila.`);
  }
  return rowToRecord(row);
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

const PLANNING_COLUMN: Record<PlanningField, keyof typeof items.$inferInsert> = {
  ADC_Manual: "adcManual",
  Lead_Time_Days: "leadTimeDays",
  Safety_Factor: "safetyFactor",
  MOQ: "moq",
  Max_Level: "maxLevel",
};

/**
 * Applies planning-field edits to many items in one batch of updates.
 *
 * Bulk Setup exists because an item master runs to hundreds of rows and the reorder
 * maths is useless until Max Level, Lead Time and Safety Factor are filled — doing that
 * one dialog at a time is not realistic, and leaving it undone is what made the user's
 * previous system never suggest a reorder.
 *
 * Only the edited fields are set per row (never a full-record overwrite), so this cannot
 * clobber a name or category that someone changed while the grid was open. A SKU this org
 * doesn't have is reported in `unknownSkus` without an update attempt; a known SKU whose
 * patch happens to carry no fields is simply a no-op, same as the original "only rows with
 * fields to write are queued" behaviour. Each remaining patch is its own UPDATE, run
 * concurrently — there is no bulk-update primitive in repo.ts, the same situation
 * createVendorsBulk() documents for inserts.
 */
export async function bulkUpdatePlanningFields(
  patches: { sku: string; fields: PlanningPatch }[]
): Promise<{ updated: number; unknownSkus: string[] }> {
  if (patches.length === 0) return { updated: 0, unknownSkus: [] };

  const orgId = await getTenantOrgId();
  const knownSkus = new Set((await listItems()).map((i) => i.SKU));

  const unknownSkus: string[] = [];
  const toUpdate: { sku: string; set: Record<string, string | number | null> }[] = [];

  for (const patch of patches) {
    if (!knownSkus.has(patch.sku)) {
      unknownSkus.push(patch.sku);
      continue;
    }

    const set: Record<string, string | number | null> = {};
    for (const [key, value] of Object.entries(patch.fields) as [
      PlanningField,
      number | null | undefined,
    ][]) {
      const column = PLANNING_COLUMN[key];
      set[column] = key === "Lead_Time_Days" ? (value ?? null) : numericCol(value);
    }
    if (Object.keys(set).length > 0) {
      toUpdate.push({ sku: patch.sku, set });
    }
  }

  await Promise.all(
    toUpdate.map(({ sku, set }) =>
      db
        .update(items)
        .set(set)
        .where(and(eq(items.orgId, orgId), eq(items.sku, sku)))
    )
  );

  return { updated: toUpdate.length, unknownSkus };
}
