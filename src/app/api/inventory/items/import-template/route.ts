import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { ITEM_CATEGORIES } from "@/lib/inventory/items";
import { buildCsv, csvResponseHeaders } from "@/lib/csv";

/**
 * The blank spreadsheet a bulk import starts from — the same column labels as the New
 * Item dialog, so filling this in feels like the same form, just wider, plus one column
 * the dialog doesn't have: Opening Stock. A single item created from the dialog starts at
 * zero and needs a separate Stock In afterwards; a bulk import of, say, an existing
 * warehouse's full item list would otherwise need one manual Stock In per row right after
 * the import, which is exactly the kind of one-at-a-time work this feature exists to
 * avoid — so a row with a positive Opening Stock gets one "Opening" ledger entry for free.
 * Header text is matched loosely on import (see itemsImport.ts), so renaming or
 * reordering these columns still works; this is only the friendliest starting point, not
 * the only accepted shape.
 */
export async function GET() {
  const guard = await requireModule("INVENTORY_SETUP");
  if (!guard.ok) return guard.response;

  const csv = buildCsv([
    [
      "Item Name",
      "SKU",
      "Category",
      "UOM",
      "Size / Unit",
      "Rate",
      "Lead Time (Days)",
      "Safety Factor",
      "MOQ",
      "Max Level",
      "Location",
      "Opening Stock",
    ],
    // One example row shows the expected shape. Its name says to remove it outright, so
    // a person who forgets ends up with an obviously-named junk row, not a silent one.
    [
      "EXAMPLE - delete this row before uploading",
      "",
      ITEM_CATEGORIES[0],
      "PCS",
      "",
      "",
      "",
      "1",
      "",
      "",
      "",
      "",
    ],
  ]);

  return new NextResponse(csv, {
    headers: csvResponseHeaders("items-import-template.csv"),
  });
}
