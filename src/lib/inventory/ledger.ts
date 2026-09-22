import type { InferSelectModel } from "drizzle-orm";
import { stockLedger } from "@/db/schema";
import { db } from "@/db/client";
import { listByOrg, insertRecord } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { num, numOr0, type ItemRecord } from "@/lib/inventory/items";
import type { Direction, LedgerSource, StockStatus } from "@/lib/inventory/constants";
// round3 lives with the allocation, which imports nothing at all — so a shared rounding
// rule costs this module no extra dependency.
import { round3 } from "@/lib/inventory/allocation";
import { stampMs } from "@/lib/timestamp";

export {
  DIRECTIONS,
  type Direction,
  LEDGER_SOURCES,
  type LedgerSource,
  type StockStatus,
} from "@/lib/inventory/constants";

/**
 * Mirrors the pre-Postgres sheet row shape exactly (same field names, same PascalCase
 * casing, everything a string) even though the persistence underneath is now the
 * `stock_ledger` Postgres table. `Timestamp` is a real UTC instant written by Postgres'
 * `defaultNow()` and read back as `.toISOString()` — safe because nothing in this codebase
 * does a raw string-prefix comparison against a ledger Timestamp (contrast Tasks'
 * `Due_Date`, which does); every comparison already goes through `stampMs`/`parseStamp`,
 * both of which parse ISO strings correctly.
 */
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

type LedgerRow = InferSelectModel<typeof stockLedger>;

function rowToRecord(row: LedgerRow): LedgerRecord {
  return {
    Txn_ID: row.id,
    Timestamp: row.timestamp.toISOString(),
    SKU: row.sku,
    Direction: row.direction,
    Quantity: row.quantity,
    UOM: row.uom,
    Source: row.source,
    Reference_ID: row.referenceId,
    Location: row.location,
    Issued_To: row.issuedTo,
    Remark: row.remark,
    User_ID: row.userId,
  };
}

export async function listLedger(): Promise<LedgerRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await listByOrg(stockLedger, orgId);
  return rows.map(rowToRecord);
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
 *
 * Rounded to three places at every step, because quantities are decimal by design (kg, m,
 * litre) and binary floating point does not add them exactly: 3.3 in and 1.1 out leaves
 * 2.1999999999999997. The screen rounds that to "2.2", so issuing 2.2 was refused with
 * "free stock 2.2 hai, aur aap 2.2 nikaal rahe hain" — an error that contradicts itself
 * and that nobody can act on. Three places is the same precision every quantity is
 * displayed and allocated at, so rounding here loses nothing real.
 */
export function onHandBySku(ledger: LedgerRecord[]): Map<string, number> {
  const stock = new Map<string, number>();
  for (const row of ledger) {
    if (!row.SKU) continue;
    const qty = numOr0(row.Quantity);
    const delta = row.Direction === "Out" ? -qty : qty;
    stock.set(row.SKU, round3((stock.get(row.SKU) ?? 0) + delta));
  }
  return stock;
}

export interface StockPosition {
  sku: string;
  onHand: number;
  committed: number;
  /** FG stock reserved against Orders (Stock_Check/Dispatch_Pending/Ready_For_PDI) — see
   * src/lib/orders/orders.ts's own orderReservedBySku(). A second, independent commitment
   * source alongside `committed` (raw-material reservation for production plans): both are
   * subtracted from on-hand to get `free`, but they are never conflated into one number,
   * since a screen may one day want to explain *why* stock isn't free. */
  orderReserved: number;
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
  inTransit: Map<string, number>,
  orderReserved: Map<string, number>
): StockPosition {
  const oh = onHand.get(sku) ?? 0;
  const cm = committed.get(sku) ?? 0;
  const it = inTransit.get(sku) ?? 0;
  const or_ = orderReserved.get(sku) ?? 0;
  // Rounded for the same reason the ledger sum is: `free` is what an Out is checked
  // against, so a trailing 0.0000000000003 here becomes a refused, self-contradicting
  // error on screen.
  return {
    sku,
    onHand: oh,
    committed: cm,
    orderReserved: or_,
    free: round3(oh - cm - or_),
    inTransit: it,
    projected: round3(oh - cm - or_ + it),
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
  orderReserved: Map<string, number>,
  adcWindowDays = 30
): ItemStock {
  const position = positionFor(item.SKU, onHand, committed, inTransit, orderReserved);

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

  const orgId = await getTenantOrgId();
  const row = await insertRecord(stockLedger, {
    id: generateId("TXN"),
    orgId,
    sku: input.sku,
    direction: input.direction,
    quantity: String(input.quantity),
    uom: input.uom,
    source: input.source,
    referenceId: input.referenceId ?? "",
    location: input.location ?? "",
    issuedTo: input.issuedTo ?? "",
    remark: input.remark ?? "",
    userId: input.userId,
  });

  if (input.direction === "In" && input.sku) {
    // Best-effort: FG stock arriving might clear a shortage some Order was waiting on
    // (src/lib/orders/orders.ts's own recheckShortfallForSku(), which never throws on its
    // own account). Dynamic import because this file is foundational and imported almost
    // everywhere — a static import of orders.ts here would be a real circular-import risk
    // (mirrors plans.ts's own dynamic import of fms/engine.ts for hasFmsLine()). Awaited,
    // not fire-and-forget, so it actually finishes before a serverless function's response
    // is sent and the runtime is frozen — but wrapped so it can never undo or fail the
    // movement that already committed above.
    try {
      const { recheckShortfallForSku } = await import("@/lib/orders/orders");
      await recheckShortfallForSku(input.sku);
    } catch (error) {
      console.error(`[ledger] recheckShortfallForSku(${input.sku}) failed:`, error);
    }
  }

  return rowToRecord(row);
}

export interface BulkMovementInput {
  sku: string;
  direction: Direction;
  quantity: number;
  uom: string;
  source: LedgerSource;
  location?: string;
  remark?: string;
  userId: string;
}

/**
 * Appends many movements in one insert — bulk item import uses this for every row's
 * Opening Stock, so importing hundreds of new items costs one extra write, not one per
 * item the way calling recordMovement() in a loop would.
 *
 * No availability check: every caller today is an `In` (Opening stock for a brand-new
 * item can't be short against anything), so the negative-stock guard recordMovement()
 * applies to `Out` never comes into play. If an `Out` direction is ever needed here too,
 * that check would need to move into this function rather than being skipped silently.
 */
export async function recordMovementsBulk(inputs: BulkMovementInput[]): Promise<void> {
  if (inputs.length === 0) return;

  const orgId = await getTenantOrgId();
  const rows = inputs.map((input) => ({
    id: generateId("TXN"),
    orgId,
    sku: input.sku,
    direction: input.direction,
    quantity: String(input.quantity),
    uom: input.uom,
    source: input.source,
    referenceId: "",
    location: input.location ?? "",
    issuedTo: "",
    remark: input.remark ?? "",
    userId: input.userId,
  }));

  await db.insert(stockLedger).values(rows);

  // Same best-effort recheck as the single-movement path above, run once per distinct SKU
  // that just received an `In` — every caller of this bulk path today only ever inserts
  // `In` rows (see this function's own doc comment), so no direction filter is dropped
  // silently by not checking it per-row.
  const inSkus = Array.from(
    new Set(inputs.filter((i) => i.direction === "In" && i.sku).map((i) => i.sku))
  );
  if (inSkus.length > 0) {
    try {
      const { recheckShortfallForSku } = await import("@/lib/orders/orders");
      for (const sku of inSkus) {
        await recheckShortfallForSku(sku);
      }
    } catch (error) {
      console.error("[ledger] recheckShortfallForSku (bulk) failed:", error);
    }
  }
}
