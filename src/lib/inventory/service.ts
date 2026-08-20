import { tryModule } from "@/lib/moduleSheets";
import { listItems, type ItemRecord } from "@/lib/inventory/items";
import {
  listLedger,
  onHandBySku,
  committedBySku,
  inTransitBySku,
  buildItemStock,
  positionFor,
  type ItemStock,
  type LedgerRecord,
} from "@/lib/inventory/ledger";

/**
 * The joins every inventory screen needs, done once.
 *
 * Items and the ledger are two separate spreadsheets, so a screen that resolved stock
 * per item would issue one read per row against a Sheets quota shared by every tenant.
 * Both sheets are read once here and matched in memory instead.
 */
export interface InventorySnapshot {
  items: ItemStock[];
  ledger: LedgerRecord[];
  /** Which of the two sheets are not connected yet, so a page can say which. */
  missingSheets: string[];
}

export async function getInventorySnapshot(
  adcWindowDays = 30
): Promise<InventorySnapshot> {
  const [items, ledger] = await Promise.all([
    tryModule(() => listItems()),
    tryModule(() => listLedger()),
  ]);

  const missingSheets = [
    items === null ? "Items (Inventory master)" : null,
    ledger === null ? "Stock Ledger" : null,
  ].filter((s): s is string => s !== null);

  if (items === null) {
    return { items: [], ledger: ledger ?? [], missingSheets };
  }

  const rows = ledger ?? [];
  const onHand = onHandBySku(rows);
  const [committed, inTransit] = await Promise.all([
    committedBySku(),
    inTransitBySku(),
  ]);

  return {
    items: items
      .filter((i) => i.SKU)
      .map((item) =>
        buildItemStock(item, rows, onHand, committed, inTransit, adcWindowDays)
      ),
    ledger: rows,
    missingSheets,
  };
}

/** Free stock for one SKU — what an `Out` is checked against before it is written. */
export async function freeStockFor(sku: string): Promise<number> {
  const ledger = (await tryModule(() => listLedger())) ?? [];
  const [committed, inTransit] = await Promise.all([
    committedBySku(),
    inTransitBySku(),
  ]);
  return positionFor(sku, onHandBySku(ledger), committed, inTransit).free;
}

export interface ItemDetail {
  stock: ItemStock;
  /** This item's movements, newest first. */
  movements: LedgerRecord[];
}

export async function getItemDetail(
  sku: string,
  adcWindowDays = 30
): Promise<ItemDetail | null> {
  const snapshot = await getInventorySnapshot(adcWindowDays);
  const stock = snapshot.items.find((i) => i.item.SKU === sku);
  if (!stock) return null;

  const movements = snapshot.ledger
    .filter((r) => r.SKU === sku)
    .sort((a, b) => b.Timestamp.localeCompare(a.Timestamp));

  return { stock, movements };
}

/** Counts by status, for the inventory dashboard's donut. */
export function statusCounts(items: ItemStock[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const i of items) {
    counts[i.status] = (counts[i.status] ?? 0) + 1;
  }
  return counts;
}

/** Items whose free stock has fallen to or below their reorder point. */
export function itemsNeedingReorder(items: ItemStock[]): ItemStock[] {
  return items
    .filter((i) => i.rop !== null && i.free <= i.rop)
    .sort((a, b) => {
      // Deepest shortfall relative to its own reorder point comes first, so a small
      // item that is completely out outranks a large one that is merely at the line.
      const aGap = a.rop ? (a.rop - a.free) / a.rop : 0;
      const bGap = b.rop ? (b.rop - b.free) / b.rop : 0;
      return bGap - aGap;
    });
}

export type { ItemRecord, ItemStock, LedgerRecord };
