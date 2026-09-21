import type { InferSelectModel } from "drizzle-orm";
import { and, eq } from "drizzle-orm";
import { bom } from "@/db/schema";
import { db } from "@/db/client";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { numOr0, findItem, createItem } from "@/lib/inventory/items";
import { suggestProductSku } from "@/lib/inventory/constants";
import { byNewest } from "@/lib/timestamp";

export { suggestProductSku };

/**
 * A component is an inventory item today. When Semi-FG arrives, a BOM line will be able
 * to point at another product instead — the column exists now because adding it later
 * would mean migrating every customer's data.
 */
export const COMPONENT_TYPES = ["Item", "Product"] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

/**
 * Mirrors the pre-Postgres flat-row shape exactly (same field names, same PascalCase
 * casing, everything a string) even though the persistence underneath is now the `bom`
 * Postgres table. `bom`'s primary key is the composite `(bom_id, line_no)` — per repo.ts's
 * `IdentifiedTable` doc comment this does NOT satisfy the generic layer, so every query
 * here is a direct, bespoke Drizzle query instead.
 */
export interface BomRow {
  BOM_ID: string;
  Product_Name: string;
  Product_SKU: string;
  Version: string;
  Line_No: string;
  Component_SKU: string;
  Component_Name: string;
  Component_Type: string;
  Qty_Per_Unit: string;
  UOM: string;
  Status: string;
  Created_At: string;
  Created_By: string;
}

export interface BomLine {
  lineNo: number;
  componentSku: string;
  componentName: string;
  componentType: ComponentType;
  qtyPerUnit: number;
  uom: string;
}

/** One product's BOM, assembled from the flat rows that share a BOM_ID. */
export interface Bom {
  bomId: string;
  productName: string;
  productSku: string;
  version: number;
  status: string;
  createdAt: string;
  createdBy: string;
  lines: BomLine[];
}

type BomRowDb = InferSelectModel<typeof bom>;

function rowToRecord(row: BomRowDb): BomRow {
  return {
    BOM_ID: row.bomId,
    Product_Name: row.productName,
    Product_SKU: row.productSku,
    Version: row.version,
    Line_No: row.lineNo,
    Component_SKU: row.componentSku,
    Component_Name: row.componentName,
    Component_Type: row.componentType,
    Qty_Per_Unit: row.qtyPerUnit ?? "",
    UOM: row.uom,
    Status: row.status,
    Created_At: row.createdAt.toISOString(),
    Created_By: row.createdBy,
  };
}

export async function listBomRows(): Promise<BomRow[]> {
  const orgId = await getTenantOrgId();
  const rows = await db.select().from(bom).where(eq(bom.orgId, orgId));
  return rows.map(rowToRecord);
}

/** Groups the flat rows back into one object per BOM, newest version first. */
export function groupBoms(rows: BomRow[]): Bom[] {
  const byId = new Map<string, Bom>();

  for (const row of rows) {
    if (!row.BOM_ID) continue;

    const existing = byId.get(row.BOM_ID);
    const bomEntry: Bom =
      existing ??
      {
        bomId: row.BOM_ID,
        productName: row.Product_Name,
        productSku: row.Product_SKU,
        version: Number(row.Version) || 1,
        status: row.Status,
        createdAt: row.Created_At,
        createdBy: row.Created_By,
        lines: [],
      };

    if (row.Component_SKU) {
      bomEntry.lines.push({
        lineNo: Number(row.Line_No) || bomEntry.lines.length + 1,
        componentSku: row.Component_SKU,
        componentName: row.Component_Name,
        componentType: (row.Component_Type as ComponentType) || "Item",
        qtyPerUnit: numOr0(row.Qty_Per_Unit),
        uom: row.UOM,
      });
    }

    if (!existing) byId.set(row.BOM_ID, bomEntry);
  }

  for (const bomEntry of byId.values()) {
    bomEntry.lines.sort((a, b) => a.lineNo - b.lineNo);
  }

  return [...byId.values()].sort(
    (a, b) => byNewest(a.createdAt, b.createdAt) || b.version - a.version
  );
}

export async function listBoms(): Promise<Bom[]> {
  return groupBoms(await listBomRows());
}

/** The BOM a production plan should use for a product — only one can be Active. */
export async function findActiveBom(productName: string): Promise<Bom | null> {
  const boms = await listBoms();
  const normalized = productName.trim().toLowerCase();
  return (
    boms.find(
      (b) => b.status === "Active" && b.productName.trim().toLowerCase() === normalized
    ) ?? null
  );
}

export interface CreateBomInput {
  productName: string;
  productSku?: string;
  lines: {
    componentSku: string;
    componentName: string;
    componentType?: ComponentType;
    qtyPerUnit: number;
    uom: string;
  }[];
  createdBy: string;
}

export class BomValidationError extends Error {}

/**
 * Creates a BOM, superseding any Active one for the same product.
 *
 * The previous version is archived rather than overwritten. Production plans snapshot
 * their materials, so history is already safe from an edit — but keeping the old BOM
 * readable is what lets someone answer "what did we build it from in March?".
 */
export async function createBom(input: CreateBomInput): Promise<Bom> {
  const productName = input.productName.trim();
  if (!productName) {
    throw new BomValidationError("Product ka naam zaroori hai.");
  }
  if (input.lines.length === 0) {
    throw new BomValidationError("Kam se kam ek item chahiye.");
  }

  for (const line of input.lines) {
    if (!line.componentSku) {
      throw new BomValidationError("Har line me ek item chunna zaroori hai.");
    }
    if (!(line.qtyPerUnit > 0)) {
      throw new BomValidationError(
        `"${line.componentName}" ki quantity 0 se zyada honi chahiye.`
      );
    }
  }

  // Two lines for the same item would double-count in every shortage calculation. It is
  // almost always a typo, so it is refused by name rather than silently summed — a
  // merged quantity looks correct and is impossible to notice afterwards.
  const seen = new Set<string>();
  for (const line of input.lines) {
    if (seen.has(line.componentSku)) {
      throw new BomValidationError(
        `"${line.componentName}" do baar aaya hai. Ek hi line me poori quantity likhein.`
      );
    }
    seen.add(line.componentSku);
  }

  const orgId = await getTenantOrgId();

  // One read, reused for both the version lookup and the SKU collision check.
  const boms = await listBoms();
  const normalized = productName.toLowerCase();
  const existing =
    boms.find(
      (b) => b.status === "Active" && b.productName.trim().toLowerCase() === normalized
    ) ?? null;
  const version = existing ? existing.version + 1 : 1;

  // A new version keeps the product's existing SKU unless the user deliberately typed a
  // different one. Letting v2 silently take a fresh SKU would split one product's history
  // into two identities.
  //
  // Falling back to a suggested SKU means a product always has one however the BOM was
  // created — the form fills the box in, but an import or an API call should not be able
  // to leave a product with no identity for production and dispatch to refer to.
  const productSku = (
    input.productSku?.trim() ||
    existing?.productSku ||
    suggestProductSku(productName)
  ).trim();

  if (productSku) {
    const clash = boms.find(
      (b) =>
        b.productSku.trim().toLowerCase() === productSku.toLowerCase() &&
        b.productName.trim().toLowerCase() !== productName.toLowerCase()
    );
    if (clash) {
      throw new BomValidationError(
        `SKU "${productSku}" pehle se "${clash.productName}" ka hai. Har product ka SKU alag hona chahiye.`
      );
    }
  }

  const bomId = generateId("BOM");
  const now = new Date();

  const rows = input.lines.map((line, i) => ({
    bomId,
    orgId,
    productName,
    productSku,
    version: String(version),
    lineNo: String(i + 1),
    componentSku: line.componentSku,
    componentName: line.componentName,
    componentType: line.componentType ?? "Item",
    qtyPerUnit: String(line.qtyPerUnit),
    uom: line.uom,
    status: "Active" as const,
    createdAt: now,
    createdBy: input.createdBy,
  }));

  // Every line in one insert — a BOM is written as a unit, and it keeps the request cost
  // flat however many components a product has.
  await db.insert(bom).values(rows);

  // Archive last: if this fails, two Active BOMs is visible and fixable, where archiving
  // first and then failing to write would leave the product with no BOM at all.
  if (existing) {
    await setBomStatus(existing.bomId, "Archived");
  }

  // A product's BOM used to be the only place its SKU existed — nothing ever created a
  // matching Items-master row, so completePlan()/an FMS Action's Stock Ledger Movement
  // would fail with "Items master me nahi hai" the very first time anyone tried to record
  // its FG stock, even though the product had clearly already been planned for. Auto-
  // creating it here (once, only if missing) means a new product shows up in
  // Inventory/Finished Goods — with Free/On Hand/ADC/ROP live like any other item — the
  // moment its BOM exists, not only after someone remembers to add it by hand. Planning
  // fields (Lead Time, Safety Factor, MOQ, Max Level) are deliberately left blank, same as
  // a manually created item — the Admin fills those in from the item detail page or Bulk
  // Setup whenever they're known. Best-effort: a BOM must not fail to save over this.
  if (productSku && !(await findItem(productSku))) {
    await createItem({
      sku: productSku,
      itemName: productName,
      category: "FG",
      uom: "PCS",
      createdBy: input.createdBy,
    }).catch(() => {});
  }

  return {
    bomId,
    productName,
    productSku,
    version,
    status: "Active",
    createdAt: now.toISOString(),
    createdBy: input.createdBy,
    lines: input.lines.map((line, i) => ({
      lineNo: i + 1,
      componentSku: line.componentSku,
      componentName: line.componentName,
      componentType: line.componentType ?? "Item",
      qtyPerUnit: line.qtyPerUnit,
      uom: line.uom,
    })),
  };
}

/** Sets the status on every row of one BOM — they all carry it. */
export async function setBomStatus(bomId: string, status: string): Promise<void> {
  const orgId = await getTenantOrgId();
  await db
    .update(bom)
    .set({ status: status as "Active" | "Archived" })
    .where(and(eq(bom.orgId, orgId), eq(bom.bomId, bomId)));
}
