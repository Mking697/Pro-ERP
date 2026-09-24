/**
 * Inventory constants with no server dependencies.
 *
 * Kept apart from items.ts and ledger.ts deliberately: those reach the database through
 * `tenant`, which imports `next/headers`. A client component that needed only the
 * category list would drag all of that into the browser bundle — and fail the build.
 */

export const ITEM_CATEGORIES = ["Raw Material", "Consumable", "Semi-FG", "FG"] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

/**
 * A starting point for the UOM autocomplete (src/components/ui/autocomplete-input.tsx),
 * not an enum — an item's UOM is never validated against this list, so a genuinely new
 * unit can still be typed. This just saves retyping "PCS" from scratch on every new item.
 *
 * The New Item dialog's own "Unit" field (Size_Unit in the schema — the name stuck from
 * before this list existed) picks from this same set, but as a closed dropdown: a unit is
 * always one of these, never a free-typed size description like "8x40mm" — that confused
 * people expecting a plain unit picker when the field showed years of old free-text sizes
 * as suggestions instead.
 */
export const COMMON_UOMS = [
  "PCS",
  "NOS",
  "KG",
  "GM",
  "MTR",
  "LTR",
  "BOX",
  "SET",
  "PAIR",
  "ROLL",
  "SQM",
  "SQFT",
  "TON",
] as const;

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
  // Dispatch (leg 5, src/lib/dispatch/dispatch.ts) — the real "Out" movement written at
  // Confirm Dispatch time, for exactly what a shipment carries. `source` is a plain text
  // column (see src/db/schema/inventory.ts's own comment), so adding this value is an
  // application-level change only, not a schema migration.
  "Dispatch",
  // A Failure Log entry (src/lib/inward/deviation.ts) accepted "Under Deviation" — a failed
  // IQC quantity the org decides to use anyway, distinct from a normal IQC pass so the
  // ledger's own audit trail shows it was a documented concession, not a clean pass.
  "IQC_Deviation",
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
