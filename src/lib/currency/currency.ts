import { and, desc, eq, lte } from "drizzle-orm";
import { currencies, exchangeRates, orgEnabledCurrencies } from "@/db/schema";
import { db } from "@/db/client";
import { generateId } from "@/lib/id";
import { getTenantOrgId } from "@/lib/tenant";
import { round2 } from "@/lib/leads/quotationMath";
import { assertFinancialNumber, MAX_EXCHANGE_RATE } from "@/lib/financial-validation";

/**
 * Multi-currency DISPLAY/REFERENCE layer (Phase C) — see src/db/schema/currency.ts's own
 * header comment for the full shape/reasoning. Every function here is additive support
 * code: nothing in this file ever touches orders.orderValue/invoices.finalValue/purchase
 * pricing directly — the one call site that does (`convertToInr()` below) returns a plain
 * number for the caller (orders.ts/accounts.ts/purchase/orders.ts) to store exactly the way
 * it already stores any other INR figure.
 */
export class CurrencyError extends Error {}

export const PLATFORM_CURRENCIES: { code: string; name: string; symbol: string }[] = [
  { code: "INR", name: "Indian Rupee", symbol: "₹" },
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "British Pound", symbol: "£" },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ" },
];

/**
 * Idempotent — inserts only whichever platform currency is still missing, same
 * "insert only what's missing" pattern as `seedDefaultChartOfAccounts()`
 * (src/lib/accounts/ledger.ts). Platform-wide, not tenant-scoped — no `orgId`/transaction
 * involved, unlike that function. Safe to call on every request.
 */
export async function seedPlatformCurrencies(): Promise<void> {
  const existing = await db.select().from(currencies);
  const existingCodes = new Set(existing.map((r) => r.code));
  for (const currency of PLATFORM_CURRENCIES) {
    if (existingCodes.has(currency.code)) continue;
    try {
      await db.insert(currencies).values(currency).onConflictDoNothing();
    } catch {
      // Tolerated race between two concurrent first-calls — same convention as
      // seedDefaultChartOfAccounts()'s own tolerated unique violation.
    }
  }
}

/**
 * Just the currencies actually usable right now on an Order/Invoice/PO creation form
 * (INR plus whatever this org has toggled on) — unlike `listEnabledCurrencies()` above
 * (the Admin settings screen, which needs to show every platform currency including
 * disabled ones so there's something to toggle), a creation form only ever needs to offer
 * what's actually enabled.
 */
export async function listUsableCurrencies(): Promise<EnabledCurrencyRecord[]> {
  const all = await listEnabledCurrencies();
  return all.filter((c) => c.isEnabled);
}

export interface EnabledCurrencyRecord {
  code: string;
  name: string;
  symbol: string;
  /** INR is always true and cannot be toggled off. */
  isEnabled: boolean;
}

/**
 * This org's currency picker for Orders/Invoices/POs — INR first (synthetic, never a real
 * `org_enabled_currencies` row, see that table's own schema comment), then every platform
 * currency with this org's own enabled flag (false if the org has never toggled it on).
 */
export async function listEnabledCurrencies(): Promise<EnabledCurrencyRecord[]> {
  await seedPlatformCurrencies();
  const orgId = await getTenantOrgId();
  const [allCurrencies, orgRows] = await Promise.all([
    db.select().from(currencies),
    db.select().from(orgEnabledCurrencies).where(eq(orgEnabledCurrencies.orgId, orgId)),
  ]);
  const enabledMap = new Map(orgRows.map((r) => [r.currencyCode, r.isEnabled]));
  const result: EnabledCurrencyRecord[] = [{ code: "INR", name: "Indian Rupee", symbol: "₹", isEnabled: true }];
  for (const currency of allCurrencies) {
    if (currency.code === "INR") continue;
    result.push({
      code: currency.code,
      name: currency.name,
      symbol: currency.symbol,
      isEnabled: enabledMap.get(currency.code) ?? false,
    });
  }
  return result;
}

/**
 * Admin-only in practice — enforced by the calling API route's own `requireRole(["Admin"])`,
 * not here (lib does the data work, route does the authz — same split as
 * src/lib/holidays.ts's own upsertHoliday()).
 */
export async function setEnabledCurrency(code: string, enabled: boolean): Promise<void> {
  if (code === "INR") {
    throw new CurrencyError("INR hamesha enabled rehta hai — ise toggle nahi kar sakte.");
  }
  await seedPlatformCurrencies();
  const [currency] = await db.select().from(currencies).where(eq(currencies.code, code)).limit(1);
  if (!currency) {
    throw new CurrencyError(`Currency "${code}" platform list me nahi hai.`);
  }
  const orgId = await getTenantOrgId();
  await db
    .insert(orgEnabledCurrencies)
    .values({ orgId, currencyCode: code, isEnabled: enabled })
    .onConflictDoUpdate({
      target: [orgEnabledCurrencies.orgId, orgEnabledCurrencies.currencyCode],
      set: { isEnabled: enabled },
    });
}

export interface ExchangeRateRecord {
  id: string;
  currencyCode: string;
  rateToInr: number;
  effectiveFrom: Date;
  createdBy: string;
  createdAt: Date;
}

/**
 * Inserts a new history row — append-only, never edits/overwrites an earlier rate (see
 * src/db/schema/currency.ts's own comment on exchange_rates for why). Admin-only in
 * practice, same split as setEnabledCurrency() above.
 */
export async function recordExchangeRate(
  currencyCode: string,
  rateToInr: number,
  createdBy: string,
  effectiveFrom?: Date
): Promise<ExchangeRateRecord> {
  if (!Number.isFinite(rateToInr) || rateToInr <= 0) {
    throw new CurrencyError("Exchange rate 0 se zyada aur finite hona chahiye.");
  }
  assertFinancialNumber(rateToInr, "Exchange rate", CurrencyError, MAX_EXCHANGE_RATE, true);
  assertFinancialNumber(round2(rateToInr), "Rounded exchange rate", CurrencyError, MAX_EXCHANGE_RATE, true);
  const orgId = await getTenantOrgId();
  const [row] = await db
    .insert(exchangeRates)
    .values({
      id: generateId("FX"),
      orgId,
      currencyCode,
      rateToInr: String(round2(rateToInr)),
      effectiveFrom: effectiveFrom ?? new Date(),
      createdBy,
    })
    .returning();
  return {
    id: row.id,
    currencyCode: row.currencyCode,
    rateToInr: Number(row.rateToInr),
    effectiveFrom: row.effectiveFrom,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

/**
 * Picks the most recent rate, as of `asOfDate`, from an already-fetched list — pure,
 * DB-free, and the actual point-in-time selection logic `getLatestExchangeRate()` below
 * just wraps with a real query. Split out so the point-in-time behavior (not just "return
 * whatever's newest right now") has a function that can be unit-tested without a database.
 */
export function pickLatestRate<T extends { effectiveFrom: Date; rateToInr: number }>(
  rates: T[],
  asOfDate: Date
): T | null {
  let best: T | null = null;
  for (const rate of rates) {
    if (rate.effectiveFrom.getTime() > asOfDate.getTime()) continue;
    if (!best || rate.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = rate;
  }
  return best;
}

/**
 * The most recent `exchange_rates` row for this org+currency with `effectiveFrom <=
 * (asOfDate ?? now)` — null if none exists yet. Callers must handle null themselves (e.g.
 * reject an order creation attempt in a currency with no configured rate) — this function
 * never throws for "no rate yet", that is a normal, expected outcome for a freshly enabled
 * currency, same "not found is a normal outcome" convention as src/db/repo.ts's own
 * updateById().
 */
export async function getLatestExchangeRate(
  currencyCode: string,
  asOfDate?: Date
): Promise<ExchangeRateRecord | null> {
  const orgId = await getTenantOrgId();
  const cutoff = asOfDate ?? new Date();
  const rows = await db
    .select()
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.orgId, orgId),
        eq(exchangeRates.currencyCode, currencyCode),
        lte(exchangeRates.effectiveFrom, cutoff)
      )
    )
    .orderBy(desc(exchangeRates.effectiveFrom))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    currencyCode: row.currencyCode,
    rateToInr: Number(row.rateToInr),
    effectiveFrom: row.effectiveFrom,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

/**
 * Pure arithmetic — the ONLY place foreign-currency math ever touches an authoritative
 * INR figure (orders.orderValue/invoices.finalValue/a PO's own pricing). Called ONCE at
 * document-creation time; the resulting INR number then flows through every existing code
 * path (credit checks, GL posting, reports) completely unchanged, exactly like any other
 * INR amount computed today.
 */
export function convertToInr(amount: number, rateToInr: number): number {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new CurrencyError("Amount 0 ya usse zyada, aur finite hona chahiye.");
  }
  if (!Number.isFinite(rateToInr) || rateToInr <= 0) {
    throw new CurrencyError("Exchange rate 0 se zyada aur finite hona chahiye.");
  }
  assertFinancialNumber(amount, "Face amount", CurrencyError);
  assertFinancialNumber(rateToInr, "Exchange rate", CurrencyError, MAX_EXCHANGE_RATE, true);
  const result = round2(amount * rateToInr);
  assertFinancialNumber(result, "Converted INR amount", CurrencyError);
  return result;
}

export interface ResolvedDisplayCurrency {
  displayCurrency: string;
  displayExchangeRate: number;
  displayAmount: number;
  /** orderValue/finalValue/etc. — the computed INR figure to store as the authoritative amount. */
  inrAmount: number;
}

/**
 * Shared helper for the one new optional path each of createDirectOrder()/createInvoice()/
 * createPurchaseOrder() gains: given an explicit foreign `currency` + `displayAmount`,
 * resolves the latest rate (rejecting with a clear error if none exists for that currency)
 * and computes the INR amount once. Returns null for every existing caller that doesn't
 * pass a foreign currency — INR, undefined/null, null, 0 — meaning "nothing to do, proceed
 * exactly as before" with the caller's own existing amount.
 */
export async function resolveDisplayCurrency(
  currency: string | undefined,
  displayAmount: number | undefined
): Promise<ResolvedDisplayCurrency | null> {
  if (!currency || currency === "INR") return null;
  if (displayAmount === undefined || displayAmount === null) {
    throw new CurrencyError("Foreign currency chuni hai to face amount dena zaroori hai.");
  }
  const rate = await getLatestExchangeRate(currency);
  if (!rate) {
    throw new CurrencyError(
      `"${currency}" ke liye abhi koi exchange rate set nahi hai — pehle Admin Settings me rate set karein.`
    );
  }
  const inrAmount = convertToInr(displayAmount, rate.rateToInr);
  return {
    displayCurrency: currency,
    displayExchangeRate: rate.rateToInr,
    displayAmount: round2(displayAmount),
    inrAmount,
  };
}
