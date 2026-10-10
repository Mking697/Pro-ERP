import { findItem, listItems, type ItemRecord } from "@/lib/inventory/items";
// In-transit lives with indents, which own the data it is derived from.
import { inTransitBySku, suggestIndentQty } from "@/lib/inventory/indents";
// Reservations live with plans, which own the data they are derived from.
import { committedBySku } from "@/lib/inventory/plans";
// FG stock reserved against Orders lives with orders, which own the data it is derived
// from — same reasoning as committedBySku above.
import { orderReservedBySku } from "@/lib/orders/orders";
import { getTenantOrgId } from "@/lib/tenant";
import {
  listLedger,
  listLedgerForSku,
  onHandBySku,
  buildItemStock,
  positionFor,
  fetchAdcBySku,
  fetchAdcForSku,
  fetchOnHandForSku,
  type MovementPage,
  type ItemStock,
  type LedgerRecord,
} from "@/lib/inventory/ledger";
import { byNewest } from "@/lib/timestamp";

/**
 * The joins every inventory screen needs, done once.
 *
 * Items and the ledger are read once here and matched in memory, rather than a screen
 * resolving stock per item with a separate read per row.
 */
export interface InventorySnapshot {
  items: ItemStock[];
  ledger: LedgerRecord[];
}

export async function getInventorySnapshot(
  adcWindowDays = 30
): Promise<InventorySnapshot> {
  const orgId = await getTenantOrgId();
  // Fetch independent inputs together. ADC is one SQL-filtered operand fold rather than
  // a full-history JS scan for every item; on-hand retains its existing round3 fold.
  const [items, ledger, committed, inTransit, orderReserved, adcBySku] = await Promise.all([
    listItems(),
    listLedger(),
    committedBySku(),
    inTransitBySku(),
    orderReservedBySku(),
    fetchAdcBySku(orgId, adcWindowDays),
  ]);

  const onHand = onHandBySku(ledger);

  return {
    items: items
      .filter((i) => i.SKU)
      .map((item) =>
        buildItemStock(
          item,
          adcBySku.get(item.SKU) ?? null,
          onHand,
          committed,
          inTransit,
          orderReserved
        )
      ),
    ledger,
  };
}

/** Free stock for one SKU — what an `Out` is checked against before it is written. */
export async function freeStockFor(sku: string): Promise<number> {
  const [ledger, committed, inTransit, orderReserved] = await Promise.all([
    listLedger(),
    committedBySku(),
    inTransitBySku(),
    orderReservedBySku(),
  ]);
  return positionFor(sku, onHandBySku(ledger), committed, inTransit, orderReserved).free;
}

export interface ItemDetail {
  stock: ItemStock;
  /** This item's movements, newest first. */
  movements: LedgerRecord[];
}

export async function getItemDetail(
  sku: string,
  adcWindowDays = 30,
  movementPage: MovementPage = {}
): Promise<ItemDetail | null> {
  const item = await findItem(sku);
  if (!item) return null;

  // Only this SKU's own movements/ADC are read — not the whole inventory snapshot
  // (PERF-02): building every item's stock and the organization's entire ledger history
  // to show one item's detail page made that page's cost grow with total item count ×
  // history size. committed/inTransit/orderReserved stay organization-wide maps (they
  // come from plans.ts/indents.ts/orders.ts, which own that data and don't expose a
  // single-SKU read), but the SKU's own movements/ADC are now SQL-filtered to it alone.
  const [movements, committed, inTransit, orderReserved, adc, onHandQuantity] = await Promise.all([
    listLedgerForSku(sku, movementPage),
    committedBySku(),
    inTransitBySku(),
    orderReservedBySku(),
    fetchAdcForSku(sku, adcWindowDays),
    fetchOnHandForSku(sku),
  ]);

  const onHand = new Map([[sku, onHandQuantity]]);
  const stock = buildItemStock(item, adc, onHand, committed, inTransit, orderReserved);

  return {
    stock,
    movements: [...movements].sort((a, b) => byNewest(a.Timestamp, b.Timestamp)),
  };
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

/** The exact flattening GET /api/inventory/items sends to the client — pulled out here
 * so a server component (a page.tsx needing initial data to avoid a client-only fetch
 * waterfall on first paint) can produce the identical shape without duplicating it.
 * Matches src/app/inventory/types.ts's own ItemRow exactly (that file can't import this
 * one without a client/server boundary issue, so the shape is kept in sync by hand —
 * both are a flat merge of ItemRecord with ItemStock's own computed fields). */
export interface InventoryItemRow extends ItemRecord {
  onHand: number;
  committed: number;
  free: number;
  inTransit: number;
  projected: number;
  adc: number | null;
  adcIsManual: boolean;
  rop: number | null;
  status: ItemStock["status"];
  missingFields: string[];
}

export async function getInventoryItemRows(): Promise<InventoryItemRow[]> {
  const snapshot = await getInventorySnapshot();
  return snapshot.items.map((i) => ({
    ...i.item,
    onHand: i.onHand,
    committed: i.committed,
    free: i.free,
    inTransit: i.inTransit,
    projected: i.projected,
    adc: i.adc,
    adcIsManual: i.adcIsManual,
    rop: i.rop,
    status: i.status,
    missingFields: i.missingFields,
  }));
}
