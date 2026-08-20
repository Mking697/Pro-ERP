import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { getInventorySnapshot, reorderSuggestions } from "@/lib/inventory/service";

export async function GET() {
  const guard = await requireModule("INVENTORY_VIEW");
  if (!guard.ok) return guard.response;

  const snapshot = await getInventorySnapshot();
  const suggestions = reorderSuggestions(snapshot.items);

  return NextResponse.json({
    suggestions: suggestions.map(({ stock, suggestedQty }) => ({
      sku: stock.item.SKU,
      itemName: stock.item.Item_Name,
      uom: stock.item.UOM,
      moq: stock.item.MOQ,
      maxLevel: stock.item.Max_Level,
      free: stock.free,
      onHand: stock.onHand,
      inTransit: stock.inTransit,
      projected: stock.projected,
      rop: stock.rop,
      status: stock.status,
      suggestedQty,
    })),
    // Items whose reorder point cannot be computed are excluded from the list above
    // rather than guessed at — reported here so the gap is visible, not silent.
    notSetUp: snapshot.items.filter((i) => i.rop === null).length,
    missingSheets: snapshot.missingSheets,
  });
}
