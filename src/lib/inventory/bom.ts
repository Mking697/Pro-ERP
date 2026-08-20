import {
  appendModuleRows,
  getModuleRows,
  recordToRow,
  updateModuleCells,
} from "@/lib/moduleSheets";
import { generateId } from "@/lib/id";
import { numOr0 } from "@/lib/inventory/items";
import { suggestProductSku } from "@/lib/inventory/constants";

const MODULE_KEY = "BOM";

export { suggestProductSku };

/**
 * A component is an inventory item today. When Semi-FG arrives, a BOM line will be able
 * to point at another product instead — the column exists now because adding it later
 * would mean migrating every customer's sheet.
 */
export const COMPONENT_TYPES = ["Item", "Product"] as const;
export type ComponentType = (typeof COMPONENT_TYPES)[number];

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

export async function listBomRows(): Promise<BomRow[]> {
  return getModuleRows<BomRow>(MODULE_KEY);
}

/** Groups the flat rows back into one object per BOM, newest version first. */
export function groupBoms(rows: BomRow[]): Bom[] {
  const byId = new Map<string, Bom>();

  for (const row of rows) {
    if (!row.BOM_ID) continue;

    const existing = byId.get(row.BOM_ID);
    const bom: Bom =
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
      bom.lines.push({
        lineNo: Number(row.Line_No) || bom.lines.length + 1,
        componentSku: row.Component_SKU,
        componentName: row.Component_Name,
        componentType: (row.Component_Type as ComponentType) || "Item",
        qtyPerUnit: numOr0(row.Qty_Per_Unit),
        uom: row.UOM,
      });
    }

    if (!existing) byId.set(row.BOM_ID, bom);
  }

  for (const bom of byId.values()) {
    bom.lines.sort((a, b) => a.lineNo - b.lineNo);
  }

  return [...byId.values()].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt) || b.version - a.version
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

  // One read, reused for both the version lookup and the SKU collision check — the
  // Sheets per-minute quota is shared across every tenant, so a second fetch here costs
  // every organization, not just this one.
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
  const productSku = (input.productSku?.trim() || existing?.productSku || "").trim();

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
  const now = new Date().toISOString();

  const rows = input.lines.map((line, i) => {
    const row: BomRow = {
      BOM_ID: bomId,
      Product_Name: productName,
      Product_SKU: productSku,
      Version: String(version),
      Line_No: String(i + 1),
      Component_SKU: line.componentSku,
      Component_Name: line.componentName,
      Component_Type: line.componentType ?? "Item",
      Qty_Per_Unit: String(line.qtyPerUnit),
      UOM: line.uom,
      Status: "Active",
      Created_At: now,
      Created_By: input.createdBy,
    };
    return recordToRow(MODULE_KEY, row);
  });

  // Every line in one call — a BOM is written as a unit, and it keeps the request cost
  // flat however many components a product has.
  await appendModuleRows(MODULE_KEY, rows);

  // Archive last: if this fails, two Active BOMs is visible and fixable, where archiving
  // first and then failing to write would leave the product with no BOM at all.
  if (existing) {
    await setBomStatus(existing.bomId, "Archived");
  }

  return {
    bomId,
    productName,
    productSku,
    version,
    status: "Active",
    createdAt: now,
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
  // A BOM spans many rows, so positions come from the full list rather than a
  // key-to-row index, which keeps only the first match per key.
  const rows = await listBomRows();
  const targets = rows
    .map((row, i) => ({ row, rowNumber: i + 2 })) // +2: header row, and 1-indexed
    .filter(({ row }) => row.BOM_ID === bomId)
    .map(({ rowNumber }) => ({ rowNumber, fields: { Status: status } }));

  await updateModuleCells(MODULE_KEY, targets);
}
