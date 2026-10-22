import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DB-free unit tests for Phase C (multi-currency DISPLAY/REFERENCE layer) —
 * src/lib/currency/currency.ts. Mirrors the mocking style of tests/dispatch-domain.test.ts
 * (mock @/db/client + @/lib/tenant directly) rather than api-access.unit.test.ts's fuller
 * in-memory SQL evaluator, since this file's DB surface is small (one select, for the
 * point-in-time rate lookup).
 *
 * The single most important test here is `resolveDisplayCurrency(undefined, undefined)` —
 * it must return null WITHOUT ever touching the database, proving that every existing
 * caller of createDirectOrder()/createInvoice()/createPurchaseOrder() (none of which pass
 * a currency today) gets byte-identical orderValue/finalValue behavior to before this
 * feature existed: this function is a no-op for them.
 */

let selectResult: { id: string; rateToInr: string; effectiveFrom: Date; createdBy: string; createdAt: Date }[] = [];
let selectCalls = 0;

vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "ORG-TEST" }));

vi.mock("@/db/client", () => ({
  db: {
    select: () => {
      selectCalls += 1;
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        limit: () => chain,
        // Mimic drizzle: the chain itself is awaitable (thenable) and resolves to rows.
        then: (resolve: (rows: typeof selectResult) => void) => resolve(selectResult),
      };
      return chain;
    },
  },
}));

import { convertToInr, CurrencyError, pickLatestRate, resolveDisplayCurrency } from "@/lib/currency/currency";

describe("convertToInr", () => {
  it.each([[-1, 83], [Infinity, 83], [NaN, 83], [1e20, 83], [100, -1], [100, Infinity], [100, NaN], [100, 1e20], [1e12, 83]])("rejects hostile amount/rate or overflow product %j", (amount, rate) => {
    expect(() => convertToInr(amount, rate)).toThrow(CurrencyError);
  });
  it("multiplies the face amount by the rate and rounds to 2 decimals", () => {
    expect(convertToInr(100, 83.5)).toBe(8350);
    expect(convertToInr(12.345, 2)).toBe(24.69);
  });

  it("rejects a non-positive or non-finite amount/rate", () => {
    expect(() => convertToInr(-1, 83)).toThrow(CurrencyError);
    expect(() => convertToInr(100, 0)).toThrow(CurrencyError);
    expect(() => convertToInr(NaN, 83)).toThrow(CurrencyError);
    expect(() => convertToInr(100, Infinity)).toThrow(CurrencyError);
  });

  it("allows a zero amount (e.g. a free sample line), only the rate must be positive", () => {
    expect(convertToInr(0, 83.5)).toBe(0);
  });
});

describe("pickLatestRate — point-in-time resolution", () => {
  const rates = [
    { rateToInr: 80, effectiveFrom: new Date("2026-01-01T00:00:00Z") },
    { rateToInr: 83, effectiveFrom: new Date("2026-06-01T00:00:00Z") },
    { rateToInr: 85, effectiveFrom: new Date("2026-10-01T00:00:00Z") },
  ];

  it("returns the most recent rate at or before the given date, not just whatever's newest", () => {
    expect(pickLatestRate(rates, new Date("2026-07-15T00:00:00Z"))?.rateToInr).toBe(83);
    expect(pickLatestRate(rates, new Date("2026-01-01T00:00:00Z"))?.rateToInr).toBe(80);
    expect(pickLatestRate(rates, new Date("2027-01-01T00:00:00Z"))?.rateToInr).toBe(85);
  });

  it("returns null when every rate is still in the future relative to the date", () => {
    expect(pickLatestRate(rates, new Date("2025-01-01T00:00:00Z"))).toBeNull();
  });

  it("returns null for an empty history", () => {
    expect(pickLatestRate([], new Date())).toBeNull();
  });
});

describe("resolveDisplayCurrency — zero regression for the default (no-currency) path", () => {
  beforeEach(() => {
    selectResult = [];
    selectCalls = 0;
  });

  it("returns null and never queries the database when currency is omitted — the exact path every existing order/invoice/PO creation call takes today", async () => {
    const result = await resolveDisplayCurrency(undefined, undefined);
    expect(result).toBeNull();
    expect(selectCalls).toBe(0);
  });

  it("returns null and never queries the database when currency is explicitly \"INR\"", async () => {
    const result = await resolveDisplayCurrency("INR", 100);
    expect(result).toBeNull();
    expect(selectCalls).toBe(0);
  });

  it("rejects a foreign currency with no face amount given", async () => {
    await expect(resolveDisplayCurrency("USD", undefined)).rejects.toThrow(CurrencyError);
  });

  it("rejects creating a document in a currency with no configured exchange rate yet", async () => {
    selectResult = [];
    await expect(resolveDisplayCurrency("USD", 100)).rejects.toThrow(
      /abhi koi exchange rate set nahi hai/
    );
  });

  it("resolves the latest rate and computes the INR amount once when a real rate exists", async () => {
    selectResult = [
      {
        id: "FX-1",
        rateToInr: "83.50",
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
        createdBy: "admin@example.com",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ];
    const result = await resolveDisplayCurrency("USD", 100);
    expect(result).toEqual({
      displayCurrency: "USD",
      displayExchangeRate: 83.5,
      displayAmount: 100,
      inrAmount: 8350,
    });
  });
});
