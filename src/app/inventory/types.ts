import type { InventoryItemRow } from "@/lib/inventory/service";
import type { StockStatus } from "@/lib/inventory/constants";

/** One row as the API returns it: the master fields flattened with its live position.
 * Identical in shape to InventoryItemRow (service.ts) — extending it directly keeps the
 * two from drifting instead of hand-duplicating every field a second time. */
export type ItemRow = InventoryItemRow;

export type { StockStatus };

/**
 * Status colours come from the same validated palette the charts use, and each badge
 * always carries its label — the warning step is under 3:1 on a light surface, so
 * colour is never the only thing saying what state an item is in.
 */
export function statusVariant(
  status: StockStatus
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "Out of Stock":
    case "Critical":
      return "destructive";
    case "Low":
      return "secondary";
    case "Overstock":
      return "outline";
    case "Not Set Up":
      return "outline";
    default:
      return "default";
  }
}

/** Quantities can be fractional (kg, m, litre) — trim trailing zeros, keep precision. */
export function qty(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return Number(value.toFixed(3)).toString();
}
