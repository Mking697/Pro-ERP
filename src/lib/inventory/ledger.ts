import type { InferSelectModel } from "drizzle-orm";
import { and, desc, eq, gte } from "drizzle-orm";
import { stockLedger } from "@/db/schema";
import { db, runInTenantTransaction } from "@/db/client";
import { assertStockAvailable, assertStockAvailableMany, type StockAvailabilityOptions } from "@/lib/inventory/availability";
import { listByOrg, insertRecord } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { findItem, num, numOr0, type ItemRecord } from "@/lib/inventory/items";
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

/**
 * One SKU's own movements, newest first — pushed into SQL (org + sku both predicates,
 * backed by `stock_ledger_org_id_sku_idx`) instead of fetching the tenant's entire ledger
 * history and filtering it in JS. A single-item detail view only ever needs this one
 * SKU's rows, never the whole organization's movement history (PERF-02).
 */
export interface MovementPage {
  /** Defaults to 100; maximum 500 movement rows per page. */
  limit?: number;
  offset?: number;
}

export async function listLedgerForSku(sku: string, page: MovementPage = {}): Promise<LedgerRecord[]> {
  const limit = page.limit ?? 100;
  const offset = page.offset ?? 0;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500 || !Number.isSafeInteger(offset) || offset < 0) {
    throw new RangeError("Movement page limit must be 1..500 and offset a nonnegative integer.");
  }
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(stockLedger)
    .where(and(eq(stockLedger.orgId, orgId), eq(stockLedger.sku, sku)))
    .orderBy(desc(stockLedger.timestamp), desc(stockLedger.id))
    .limit(limit)
    .offset(offset);
  return rows.map(rowToRecord);
}

/** On-hand must not be derived from a movement page. Read only this SKU's numeric
 * operands and preserve onHandBySku's existing per-step round3, including historical
 * quantities with more than three decimals. A SQL SUM would change that behavior.
 * No timestamp sort here: the old listByOrg scan was also unordered. */
export async function fetchOnHandForSku(sku: string): Promise<number> {
  const orgId = await getTenantOrgId();
  const rows = await db.select({ direction: stockLedger.direction, quantity: stockLedger.quantity })
    .from(stockLedger)
    .where(and(eq(stockLedger.orgId, orgId), eq(stockLedger.sku, sku)));
  let total = 0;
  for (const row of rows) {
    const quantity = numOr0(row.quantity);
    total = round3(total + (row.direction === "Out" ? -quantity : quantity));
  }
  return total;
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
 *
 * Kept for callers with a ledger array and as the reference formula. Snapshot/detail
 * use fetchAdcBySku/fetchAdcForSku: SQL filters the operands, then one JS fold retains
 * this exact addition/division semantics instead of scanning all history per item.
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

/** One SQL-filtered read of ADC operands, folded once by SKU. Retain JS addition:
 * PostgreSQL numeric SUM changes 0.1 + 0.2 and can change ROP/status at a boundary.
 * Like the original ledger read, operand order is unspecified (no new sort).
 * Missing map entries mean no qualifying Out rows, not zero consumption. */
export async function fetchAdcBySku(
  orgId: string,
  windowDays = 30
): Promise<Map<string, number>> {
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const rows = await db
    .select({ sku: stockLedger.sku, quantity: stockLedger.quantity })
    .from(stockLedger)
    .where(and(eq(stockLedger.orgId, orgId), eq(stockLedger.direction, "Out"), gte(stockLedger.timestamp, since)));
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.sku, (totals.get(row.sku) ?? 0) + numOr0(row.quantity));
  for (const [sku, total] of totals) totals.set(sku, total / windowDays);
  return totals;
}

/** Same JS fold, with tenant/SKU/direction/window filtering in SQL. */
export async function fetchAdcForSku(sku: string, windowDays = 30): Promise<number | null> {
  const orgId = await getTenantOrgId();
  const since = new Date(Date.now() - windowDays * 86_400_000);
  const rows = await db
    .select({ quantity: stockLedger.quantity })
    .from(stockLedger)
    .where(and(eq(stockLedger.orgId, orgId), eq(stockLedger.sku, sku), eq(stockLedger.direction, "Out"), gte(stockLedger.timestamp, since)));
  if (!rows.length) return null;
  return rows.reduce((total, row) => total + numOr0(row.quantity), 0) / windowDays;
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

/**
 * Everything a screen needs about one item, given its ADC already resolved (SQL
 * aggregate, see `fetchAdcBySku`/`fetchAdcForSku`) — no per-item ledger scan happens in
 * here anymore (PERF-02); callers that still need the ledger for something else (on-hand
 * totals, the movement history itself) keep fetching it separately.
 */
export function buildItemStock(
  item: ItemRecord,
  adcFromLedgerValue: number | null,
  onHand: Map<string, number>,
  committed: Map<string, number>,
  inTransit: Map<string, number>,
  orderReserved: Map<string, number>
): ItemStock {
  const position = positionFor(item.SKU, onHand, committed, inTransit, orderReserved);

  const manual = num(item.ADC_Manual);
  const adc = manual ?? adcFromLedgerValue;
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

/** A movement's SKU must resolve to a tenant-owned item before anything is written —
 * never silently write stock for an unowned/foreign/missing SKU. Mirrors the typed
 * 4xx admission-error shape already used by DATA-06's vendor/BOM/Indent slices. */
export class LedgerAdmissionError extends Error {
  constructor(message: string, public readonly status: 400 | 404 = 404) {
    super(message);
    this.name = "LedgerAdmissionError";
  }
}

async function admitOwnedItem(sku: string): Promise<ItemRecord> {
  const item = await findItem(sku);
  if (!item) throw new LedgerAdmissionError(`SKU "${sku}" Items master me nahi hai.`, 404);
  return item;
}

/** Resolves and validates every distinct SKU in one batch, in a single pass — a bulk
 * writer must reject the WHOLE batch before any insert if even one SKU is unowned,
 * never partially admit some rows and write the rest. */
async function admitOwnedSkus(skus: readonly string[]): Promise<void> {
  for (const sku of new Set(skus)) await admitOwnedItem(sku);
}

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
  available?: number,
  /** Trusted service exclusions only; public routes must never forward body options. */
  options?: StockAvailabilityOptions
): Promise<LedgerRecord> {
  // Legacy availability is retained for source compatibility, never for admission.
  void available;
  validateMovementQuantity(input.quantity);
  const orgId = await getTenantOrgId();
  return runInTenantTransaction(orgId, async () => {
  await admitOwnedItem(input.sku);
  if (input.direction === "Out") await assertStockAvailable(input.sku, input.quantity, options);
  const row = await insertRecord(stockLedger, {
    id: generateId("TXN"),
    orgId,
    sku: input.sku,
    direction: input.direction,
    quantity: String(round3(input.quantity)),
    uom: input.uom,
    source: input.source,
    referenceId: input.referenceId ?? "",
    location: input.location ?? "",
    issuedTo: input.issuedTo ?? "",
    remark: input.remark ?? "",
    userId: input.userId,
  });

  if (input.direction === "In" && input.sku) {
    // Required reservation/activity writes share the movement's tenant lock and rollback.
    await recheckReceivedSkus([input.sku]);
  }
  return rowToRecord(row);
  });
}

/** Validate before writing: stock uses exactly three-decimal precision. */
export function validateMovementQuantity(quantity: number): void {
  const normalized = round3(quantity);
  if (!Number.isFinite(quantity) || !Number.isFinite(normalized) || quantity <= 0 || normalized <= 0 ||
      Math.abs(normalized - quantity) > Number.EPSILON * Math.max(1, Math.abs(quantity)) * 4) {
    throw new Error("Quantity finite, positive aur maximum 3 decimal honi chahiye.");
  }
}

async function recheckReceivedSkus(skus: string[]): Promise<void> {
  // Lazy import avoids the Orders -> ledger cycle; await all DB work in this scope.
  const { recheckShortfallForSku } = await import("@/lib/orders/orders");
  for (const sku of skus) await recheckShortfallForSku(sku);
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
 * Every Out in the batch is admitted together against authoritative availability
 * under the same tenant lock as the insert, including aggregate duplicate-SKU demand.
 */
export async function recordMovementsBulk(inputs: BulkMovementInput[]): Promise<void> {
  if (inputs.length === 0) return;
  for (const input of inputs) validateMovementQuantity(input.quantity);
  const orgId = await getTenantOrgId();
  await runInTenantTransaction(orgId, async () => {
  await admitOwnedSkus(inputs.map((input) => input.sku));
  const requests = inputs.filter((input) => input.direction === "Out").map(({ sku, quantity }) => ({ sku, quantity }));
  if (requests.length) await assertStockAvailableMany(requests);
  const rows = inputs.map((input) => ({
    id: generateId("TXN"),
    orgId,
    sku: input.sku,
    direction: input.direction,
    quantity: String(round3(input.quantity)),
    uom: input.uom,
    source: input.source,
    referenceId: "",
    location: input.location ?? "",
    issuedTo: "",
    remark: input.remark ?? "",
    userId: input.userId,
  }));

  await db.insert(stockLedger).values(rows);

  // Required Order/PDI DB successors run before commit, once per received SKU.
  const inSkus = Array.from(new Set(inputs.filter((i) => i.direction === "In" && i.sku).map((i) => i.sku)));
  if (inSkus.length) await recheckReceivedSkus(inSkus);
  });
}
