import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { tryModule } from "@/lib/moduleSheets";
import { listActiveItems } from "@/lib/inventory/items";

/**
 * Minimal item list for pickers — SKU, name and unit only, no stock or costing.
 *
 * Needs only a session, not INVENTORY_VIEW: someone recording an inward entry or
 * building a BOM has to name an item without necessarily being allowed to see stock
 * positions or rates.
 */
export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const items = await tryModule(() => listActiveItems());

  return NextResponse.json({
    items: (items ?? []).map((i) => ({
      sku: i.SKU,
      name: i.Item_Name,
      uom: i.UOM,
      sizeUnit: i.Size_Unit,
      category: i.Category,
    })),
    configured: items !== null,
  });
}
