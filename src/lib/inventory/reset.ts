import { eq } from "drizzle-orm";
import { items, stockLedger } from "@/db/schema";
import { db, runInTenantTransaction } from "@/db/client";
import { getTenantOrgId } from "@/lib/tenant";

export interface ResetInventoryResult {
  itemsDeleted: number;
  ledgerEntriesDeleted: number;
}

/**
 * Wipes the entire Items master (every category — Raw Material/Consumable/Semi-FG/FG,
 * both the main Inventory board and the Finished Goods board read the same `items` table)
 * and every Stock_Ledger movement for the org, in one atomic transaction.
 *
 * Deliberately a full, unconditional wipe — unlike resetAllFmsData()'s own
 * production-linked-run guard, there is nothing here to protect: no other table in this
 * schema carries a real FK against `items.sku` or `stock_ledger` (see items.ts's own doc
 * comment — SKU is plain, unenforced text everywhere it's referenced), so a stale Indent/
 * BOM/Order row pointing at a since-deleted SKU is cosmetically dangling but never a
 * foreign-key violation. Exists for the "a client's first bulk upload was wrong, start
 * the item master and its stock history over from zero before the real upload" case —
 * not a per-item correction (use the existing per-item edit/delete-free flows for that).
 */
export async function resetAllInventoryData(): Promise<ResetInventoryResult> {
  const orgId = await getTenantOrgId();
  return runInTenantTransaction(orgId, async () => {
    const deletedLedger = await db
      .delete(stockLedger)
      .where(eq(stockLedger.orgId, orgId))
      .returning({ id: stockLedger.id });
    const deletedItems = await db
      .delete(items)
      .where(eq(items.orgId, orgId))
      .returning({ sku: items.sku });
    return { itemsDeleted: deletedItems.length, ledgerEntriesDeleted: deletedLedger.length };
  });
}
