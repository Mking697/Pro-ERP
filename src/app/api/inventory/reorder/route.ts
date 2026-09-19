import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { getInventorySnapshot, reorderSuggestions } from "@/lib/inventory/service";
import { listVendorsForSkus } from "@/lib/parties/vendorItems";

export async function GET() {
  const guard = await requireModule("INVENTORY_VIEW");
  if (!guard.ok) return guard.response;

  const snapshot = await getInventorySnapshot();
  const suggestions = reorderSuggestions(snapshot.items);
  const vendorsBySku = await listVendorsForSkus(suggestions.map((s) => s.stock.item.SKU));

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
      // Cheapest-first Purchase Vendors already linked to this SKU, so raising an indent
      // shows who supplies it and at what price without leaving this page.
      vendors: vendorsBySku.get(stock.item.SKU) ?? [],
    })),
    // Items whose reorder point cannot be computed are excluded from the list above
    // rather than guessed at — reported here so the gap is visible, not silent.
    notSetUp: snapshot.items.filter((i) => i.rop === null).length,
  });
}
