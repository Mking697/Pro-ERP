/**
 * Inventory constants with no server dependencies.
 *
 * Kept apart from items.ts and ledger.ts deliberately: those reach the database through
 * `tenant`, which imports `next/headers`. A client component that needed only the
 * category list would drag all of that into the browser bundle — and fail the build.
 */

export const ITEM_CATEGORIES = ["Raw Material", "Consumable", "Semi-FG", "FG"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const DIRECTIONS = ["In", "Out"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Where a movement came from — see the ledger for why every row carries this. */
export const LEDGER_SOURCES = [
  "Opening",
  "Manual",
  "Form",
  "IQC",
  "Production",
  "Production_Output",
  "Indent_Receipt",
  "Adjustment",
  // One generic source for every admin-configured FMS step action — which template/step
  // caused it lives in Reference_ID/Remark, not here, so this never needs extending
  // again per new template. See src/lib/fms/actionRunner.ts.
  "FMS",
] as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[number];

export type StockStatus =
  | "Out of Stock"
  | "Critical"
  | "Low"
  | "Healthy"
  | "Overstock"
  | "Not Set Up";

/**
 * Turns a product name into a usable SKU: "Sliding Door 80mm" -> "FG-SLIDING-DOOR-80MM".
 *
 * Suggested rather than imposed. A product SKU is how production, dispatch and any
 * outside system will refer to this product for years, and organizations usually already
 * have a coding scheme — so the box stays editable and this is only the starting point.
 */
export function suggestProductSku(productName: string): string {
  const slug = productName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 28);
  return slug ? `FG-${slug}` : "";
}
