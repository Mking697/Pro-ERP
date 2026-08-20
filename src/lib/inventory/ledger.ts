import { appendModuleRow, getModuleRows, recordToRow } from "@/lib/moduleSheets";
import { generateId } from "@/lib/id";
import { num, numOr0, type ItemRecord } from "@/lib/inventory/items";
import type { Direction, LedgerSource, StockStatus } from "@/lib/inventory/constants";

const MODULE_KEY = "STOCK_LEDGER";

export {
  DIRECTIONS,
  type Direction,
  LEDGER_SOURCES,
  type LedgerSource,
  type StockStatus,
} from "@/lib/inventory/constants";
import { nowStamp, stampMs } from "@/lib/timestamp";

export interface LedgerRecord {
  Txn_ID: string;
  Timestamp: string;
  SKU: string;
  Direction: string;
  Quantity: string;
  UOM: string;
  Source: string;
  Reference_ID: string;
  Location: string;
  Issued_To: string;
  Remark: string;
  User_ID: string;
}

export async function listLedger(): Promise<LedgerRecord[]> {
  return getModuleRows<LedgerRecord>(MODULE_KEY);
}

export async function listLedgerForSku(sku: string): Promise<LedgerRecord[]> {
  const all = await listLedger();
  return all.filter((r) => r.SKU === sku);
}

/**
 * On-hand quantity per SKU, derived from the ledger.
 *
 * Stock is never stored. Every screen recomputes it from the movements, so there is no
 * cached total that can drift out of step with the rows that produced it.
 */
export function onHandBySku(ledger: LedgerRecord[]): Map<string, number> {
  const stock = new Map<string, number>();
  for (const row of ledger) {
    if (!row.SKU) continue;
    const qty = numOr0(row.Quantity);
    const delta = row.Direction === "Out" ? -qty : qty;
    stock.set(row.SKU, (stock.get(row.SKU) ?? 0) + delta);
  }
  return stock;
}

export interface StockPosition {
  sku: string;
  onHand: number;
  committed: number;
  /** What anything planning new work is allowed to see. */
  free: number;
  inTransit: number;
  /** free + what is already on its way. */
  projected: number;
}

export function positionFor(
  sku: string,
  onHand: Map<string, number>,
  committed: Map<string, number>,
  inTransit: Map<string, number>
): StockPosition {
  const oh = onHand.get(sku) ?? 0;
  const cm = committed.get(sku) ?? 0;
  const it = inTransit.get(sku) ?? 0;
  return {
    sku,
    onHand: oh,
    committed: cm,
    free: oh - cm,
    inTransit: it,
    projected: oh - cm + it,
  };
}

/**
 * Average daily consumption over a window, from `Out` movements only.
 *
 * Production and manual issues both count; receipts do not. Returns null when the item
 * has never moved out, because 0 would make the reorder point 0 and quietly declare
 * every such item healthy forever.
 */
export function adcFromLedger(
  ledger: LedgerRecord[],
  sku: string,
  windowDays = 30
): number | null {
  const since = Date.now() - windowDays * 86_400_000;
  let total = 0;
  let sawAny = false;

  for (const row of ledger) {
    if (row.SKU !== sku || row.Direction !== "Out") continue;
    const t = stampMs(row.Timestamp);
    if (Number.isNaN(t) || t < since) continue;
    total += numOr0(row.Quantity);
    sawAny = true;
  }

  return sawAny ? total / windowDays : null;
}

export interface ItemStock extends StockPosition {
  item: ItemRecord;
  /** Manual override when set, otherwise computed from the ledger. */
  adc: number | null;
  adcIsManual: boolean;
  /** ADC × Lead Time × Safety Factor, or null when any input is missing. */
  rop: number | null;
  status: StockStatus;
  missingFields: string[];
}

/**
 * Reorder point. Null — not zero — when any input is missing, so a half-configured item
 * is reported as "Not Set Up" instead of masquerading as healthy.
 */
export function reorderPoint(
  adc: number | null,
  leadTimeDays: number | null,
  safetyFactor: number | null
): number | null {
  if (adc === null || leadTimeDays === null || safetyFactor === null) return null;
  return adc * leadTimeDays * safetyFactor;
}

export function stockStatus(
  free: number,
  rop: number | null,
  maxLevel: number | null
): StockStatus {
  if (free <= 0) return "Out of Stock";
  if (rop === null) return "Not Set Up";
  if (free <= rop) return "Critical";
  if (free <= rop * 1.5) return "Low";
  if (maxLevel !== null && free > maxLevel) return "Overstock";
  return "Healthy";
}

/** Everything a screen needs about one item, in one pass over the ledger. */
export function buildItemStock(
  item: ItemRecord,
  ledger: LedgerRecord[],
  onHand: Map<string, number>,
  committed: Map<string, number>,
  inTransit: Map<string, number>,
  adcWindowDays = 30
): ItemStock {
  const position = positionFor(item.SKU, onHand, committed, inTransit);

  const manual = num(item.ADC_Manual);
  const adc = manual ?? adcFromLedger(ledger, item.SKU, adcWindowDays);
  const rop = reorderPoint(adc, num(item.Lead_Time_Days), num(item.Safety_Factor));
  const maxLevel = num(item.Max_Level);

  const missingFields: string[] = [];
  if (num(item.Max_Level) === null) missingFields.push("Max Level");
  if (num(item.Lead_Time_Days) === null) missingFields.push("Lead Time");
  if (num(item.Safety_Factor) === null) missingFields.push("Safety Factor");
  if (adc === null) missingFields.push("ADC");

  return {
    ...position,
    item,
    adc,
    adcIsManual: manual !== null,
    rop,
    status: stockStatus(position.free, rop, maxLevel),
    missingFields,
  };
}

export interface RecordMovementInput {
  sku: string;
  direction: Direction;
  quantity: number;
  uom: string;
  source: LedgerSource;
  referenceId?: string;
  location?: string;
  issuedTo?: string;
  remark?: string;
  userId: string;
}

export class InsufficientStockError extends Error {}

/**
 * Appends one movement.
 *
 * An `Out` larger than free stock is refused rather than warned about: the user asked
 * for this, and it is also the only way the ledger stays a believable record — a
 * negative on-hand means either a typo or a missing opening balance, and both are
 * cheaper to fix at entry than to unpick weeks later.
 *
 * The check reads free stock, not on-hand, so material already promised to a production
 * plan cannot be issued out from under it.
 */
export async function recordMovement(
  input: RecordMovementInput,
  available?: number
): Promise<LedgerRecord> {
  if (!(input.quantity > 0)) {
    throw new Error("Quantity 0 se zyada honi chahiye.");
  }

  if (input.direction === "Out" && available !== undefined) {
    if (input.quantity > available) {
      throw new InsufficientStockError(
        `Stock kam hai. Free stock ${available} ${input.uom} hai, aur aap ${input.quantity} ${input.uom} nikal rahe hain.`
      );
    }
  }

  const record: LedgerRecord = {
    Txn_ID: generateId("TXN"),
    Timestamp: nowStamp(),
    SKU: input.sku,
    Direction: input.direction,
    Quantity: String(input.quantity),
    UOM: input.uom,
    Source: input.source,
    Reference_ID: input.referenceId ?? "",
    Location: input.location ?? "",
    Issued_To: input.issuedTo ?? "",
    Remark: input.remark ?? "",
    User_ID: input.userId,
  };

  await appendModuleRow(MODULE_KEY, recordToRow(MODULE_KEY, record));
  return record;
}
