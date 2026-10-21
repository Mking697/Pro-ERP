import { describe, expect, it } from "vitest";
import {
  normalizeSavedViewInput,
  roundTripFilters,
  SAVED_VIEW_MAX_NAME_LENGTH,
  SavedViewValidationError,
} from "@/lib/savedViews/validation";
import type { OrdersFilters } from "@/app/orders/types";
import type { InventoryFilters } from "@/app/inventory/types";

// Pure logic only, exactly like tests/barcode-scan-match.unit.test.ts — no DATABASE_URL
// is set in this environment, and src/lib/savedViews.ts (the real DB-backed module)
// throws at import time if it is (see src/db/client.ts). These cover the two things that
// can go wrong in the "Saved Views/Filters" feature without ever touching a database:
// input validation, and the save→load round trip of each board's own filters shape.

describe("normalizeSavedViewInput", () => {
  it("trims a valid module + name", () => {
    expect(normalizeSavedViewInput({ module: "  orders  ", name: "  My View  " })).toEqual({
      module: "orders",
      name: "My View",
    });
  });

  it("rejects a blank module", () => {
    expect(() => normalizeSavedViewInput({ module: "   ", name: "My View" })).toThrow(
      SavedViewValidationError
    );
  });

  it("rejects a blank (or whitespace-only) name", () => {
    expect(() => normalizeSavedViewInput({ module: "orders", name: "" })).toThrow(
      SavedViewValidationError
    );
    expect(() => normalizeSavedViewInput({ module: "orders", name: "   " })).toThrow(
      SavedViewValidationError
    );
  });

  it("rejects a name longer than the max length", () => {
    const tooLong = "x".repeat(SAVED_VIEW_MAX_NAME_LENGTH + 1);
    expect(() => normalizeSavedViewInput({ module: "orders", name: tooLong })).toThrow(
      SavedViewValidationError
    );
  });

  it("accepts a name exactly at the max length", () => {
    const exact = "x".repeat(SAVED_VIEW_MAX_NAME_LENGTH);
    expect(normalizeSavedViewInput({ module: "orders", name: exact }).name).toBe(exact);
  });
});

describe("roundTripFilters — Orders board", () => {
  it("saves and loads back the exact same OrdersFilters shape", () => {
    const filters: OrdersFilters = { tab: "Dispatch_Pending" };
    expect(roundTripFilters(filters)).toEqual(filters);
  });

  it("round-trips every real tab value, including 'all' and 'intake'", () => {
    for (const tab of ["intake", "Payment_Review", "Credit_Hold", "Stock_Check", "Dispatch_Pending", "Ready_For_PDI", "all"]) {
      const filters: OrdersFilters = { tab };
      expect(roundTripFilters(filters)).toEqual({ tab });
    }
  });
});

describe("roundTripFilters — Inventory board", () => {
  it("saves and loads back the exact same InventoryFilters shape", () => {
    const filters: InventoryFilters = { search: "SKU-001", status: "Low" };
    expect(roundTripFilters(filters)).toEqual(filters);
  });

  it("round-trips an empty search with the 'All' status filter", () => {
    const filters: InventoryFilters = { search: "", status: "All" };
    expect(roundTripFilters(filters)).toEqual(filters);
  });

  it("never drops or reorders fields across the round trip", () => {
    const filters: InventoryFilters = { search: "steel rod", status: "Critical" };
    const result = roundTripFilters(filters);
    expect(Object.keys(result).sort()).toEqual(["search", "status"]);
    expect(result.search).toBe("steel rod");
    expect(result.status).toBe("Critical");
  });
});
