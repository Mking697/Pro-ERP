import { withApiKeyTenant } from "@/lib/auth/apiKeyGuard";
import { listActiveItems } from "@/lib/inventory/items";
import { getStockAvailability } from "@/lib/inventory/availability";
import { paginate } from "@/lib/apiAccess/pagination";

interface StockLevelRow {
  SKU: string;
  Item_Name: string;
  UOM: string;
  on_hand: number;
  reserved: number;
  free: number;
}

/** GET /api/v1/stock — current stock/inventory levels per item, read-only. Combines the
 * active item master with `getStockAvailability()`'s own on-hand/reserved/free view (the
 * same authoritative read every session-based stock screen already uses).
 * `?limit=&cursor=` for pagination. */
export async function GET(request: Request) {
  return withApiKeyTenant(request, async () => {
    const url = new URL(request.url);
    const [items, availability] = await Promise.all([listActiveItems(), getStockAvailability()]);

    const rows: StockLevelRow[] = items.map((item) => ({
      SKU: item.SKU,
      Item_Name: item.Item_Name,
      UOM: item.UOM,
      on_hand: availability.onHand.get(item.SKU) ?? 0,
      reserved: (availability.orderReserved.get(item.SKU) ?? 0) + (availability.planReserved.get(item.SKU) ?? 0),
      free: availability.free.get(item.SKU) ?? 0,
    }));

    return paginate(rows, url);
  });
}
