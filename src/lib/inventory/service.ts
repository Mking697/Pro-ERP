import { tryModule } from "@/lib/moduleSheets";
import { listItems, type ItemRecord } from "@/lib/inventory/items";
// In-transit lives with indents, which own the data it is derived from.
import { inTransitBySku, suggestIndentQty } from "@/lib/inventory/indents";
// Reservations live with plans, which own the data they are derived from.
import { committedBySku } from "@/lib/inventory/plans";
import {
  listLedger,
  onHandBySku,
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
  // All four in one round. None of them depends on another, so waiting for items and the
  // ledger before asking about reservations and open orders doubled the wall-clock time
  // of the slowest call on every inventory screen — each round is a Sheets round trip,
  // and those are hundreds of milliseconds, not microseconds.
  const [items, ledger, committed, inTransit] = await Promise.all([
    tryModule(() => listItems()),
    tryModule(() => listLedger()),
    committedBySku(),
    inTransitBySku(),
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
  const [ledger, committed, inTransit] = await Promise.all([
    tryModule(() => listLedger()),
    committedBySku(),
    inTransitBySku(),
  ]);
  return positionFor(sku, onHandBySku(ledger ?? []), committed, inTransit).free;
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

export interface ReorderSuggestion {
  stock: ItemStock;
  /** How much to order, before the person adjusts it. */
  suggestedQty: number;
}

/**
 * Items at or below their reorder point, worst first, with a quantity to order.
 *
 * The comparison uses *projected* stock, not free: something already on its way should
 * not be ordered twice. An item whose reorder point cannot be computed is left out
 * entirely rather than guessed at.
 */
export function reorderSuggestions(items: ItemStock[]): ReorderSuggestion[] {
  return itemsNeedingReorder(items).map((stock) => ({
    stock,
    suggestedQty: suggestIndentQty(stock.item, stock.projected),
  }));
}

/** Items whose projected stock has fallen to or below their reorder point. */
export function itemsNeedingReorder(items: ItemStock[]): ItemStock[] {
  return items
    .filter((i) => i.rop !== null && i.projected <= i.rop)
    .sort((a, b) => {
      // Deepest shortfall relative to its own reorder point comes first, so a small
      // item that is completely out outranks a large one that is merely at the line.
      const aGap = a.rop ? (a.rop - a.projected) / a.rop : 0;
      const bGap = b.rop ? (b.rop - b.projected) / b.rop : 0;
      return bGap - aGap;
    });
}

export type { ItemRecord, ItemStock, LedgerRecord };
