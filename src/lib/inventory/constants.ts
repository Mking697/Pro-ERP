/**
 * Inventory constants with no server dependencies.
 *
 * Kept apart from items.ts and ledger.ts deliberately: those reach the Sheets client
 * through moduleSheets and tenant, which import `next/headers` and googleapis. A client
 * component that needed only the category list would drag all of that into the browser
 * bundle — and fail the build.
 */

export const ITEM_CATEGORIES = ["Raw Material", "Consumable"] as const;
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
] as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[number];

export type StockStatus =
  | "Out of Stock"
  | "Critical"
  | "Low"
  | "Healthy"
  | "Overstock"
  | "Not Set Up";
