import { describe, expect, it } from "vitest";
import { bulkAdvanceActionFor, bulkCancelAllowed } from "@/app/orders/orders-board";
import type { OrderRow, OrderStatus } from "@/app/orders/types";

/**
 * DB-free: these two functions are pure over OrderRow[] — no fetch/db/React involved.
 * Order FMS is a workflow (see src/lib/orders/orders.ts), not a free "pick any status"
 * field, so the bulk status-change control must only ever offer an action that is valid
 * for EVERY selected row's current status. These tests pin that contract down so a future
 * edit can't silently let a bulk action apply to a mixed/invalid selection.
 */
function makeOrder(status: OrderStatus, id = "ORD-1"): OrderRow {
  return {
    id,
    source: "Direct",
    transportArrangedBy: "Self",
    leadId: "",
    quotationId: "",
    customerId: "CUST-1",
    partyName: "Test Party",
    contactPerson: "",
    customerMobile: "",
    customerEmail: "",
    customerGst: "",
    billingAddress: "",
    billingCity: "",
    billingState: "",
    billingPincode: "",
    shippingPartyName: "",
    shippingContactPerson: "",
    shippingAddress: "",
    shippingCity: "",
    shippingState: "",
    shippingPincode: "",
    poAttachmentUrl: "",
    status,
    orderValue: 1000,
    displayCurrency: "INR",
    displayExchangeRate: null,
    creditApprovedBy: "",
    creditApprovedAt: "",
    dispatchCommitDate: "",
    createdBy: "USR-1",
    createdAt: new Date().toISOString(),
    items: [],
  };
}

describe("bulkAdvanceActionFor", () => {
  it("returns null for an empty selection", () => {
    expect(bulkAdvanceActionFor([])).toBeNull();
  });

  it("returns null for a mixed-status selection — never guesses which status wins", () => {
    const selected = [makeOrder("Payment_Review", "ORD-1"), makeOrder("Stock_Check", "ORD-2")];
    expect(bulkAdvanceActionFor(selected)).toBeNull();
  });

  it("returns null for a terminal status (Ready_For_PDI/Cancelled) — nothing left to advance", () => {
    expect(bulkAdvanceActionFor([makeOrder("Ready_For_PDI")])).toBeNull();
    expect(bulkAdvanceActionFor([makeOrder("Cancelled")])).toBeNull();
  });

  it("offers Payment Review's own action when every selected row is Payment_Review", () => {
    const selected = [makeOrder("Payment_Review", "ORD-1"), makeOrder("Payment_Review", "ORD-2")];
    const action = bulkAdvanceActionFor(selected);
    expect(action?.key).toBe("payment-review");
    expect(action?.path("ORD-1")).toBe("/api/orders/ORD-1/payment-review");
    expect(action?.needsDate).toBeFalsy();
  });

  it("offers Credit Hold's approve action -> Stock_Check", () => {
    const action = bulkAdvanceActionFor([makeOrder("Credit_Hold")]);
    expect(action?.key).toBe("credit-approve");
    expect(action?.path("ORD-9")).toBe("/api/orders/ORD-9/credit-approve");
  });

  it("offers Stock Check's own action -> Dispatch_Pending", () => {
    const action = bulkAdvanceActionFor([makeOrder("Stock_Check")]);
    expect(action?.key).toBe("stock-check");
  });

  it("offers Dispatch Commit and flags that it needs a date input", () => {
    const action = bulkAdvanceActionFor([makeOrder("Dispatch_Pending")]);
    expect(action?.key).toBe("dispatch-commit");
    expect(action?.needsDate).toBe(true);
  });
});

describe("bulkCancelAllowed", () => {
  it("is false for an empty selection", () => {
    expect(bulkCancelAllowed([])).toBe(false);
  });

  it("is true for any mix of non-terminal statuses — Cancel works from any of them", () => {
    const selected = [makeOrder("Payment_Review", "ORD-1"), makeOrder("Dispatch_Pending", "ORD-2")];
    expect(bulkCancelAllowed(selected)).toBe(true);
  });

  it("is false the moment ANY selected row is already terminal", () => {
    const selected = [makeOrder("Payment_Review", "ORD-1"), makeOrder("Ready_For_PDI", "ORD-2")];
    expect(bulkCancelAllowed(selected)).toBe(false);
    expect(bulkCancelAllowed([makeOrder("Cancelled")])).toBe(false);
  });
});
