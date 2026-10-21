import { expect, it } from "vitest";
import { billingCheckoutMode, hasOpenSubscription } from "@/lib/billing/checkout-mode";

it("retains one-time checkout until recurring billing is explicitly enabled", () => {
  expect(billingCheckoutMode({ subscriptionsEnabled: false })).toBe("order");
  expect(billingCheckoutMode(null)).toBe("order");
  expect(billingCheckoutMode({ subscriptionsEnabled: true })).toBe("subscription");
});
it.each(["created", "authenticated", "active", "pending", "halted", "creating", "unknown"])("blocks a competing purchase while subscription state is %s", (status) => {
  expect(hasOpenSubscription(status)).toBe(true);
});
it.each(["", "cancelled", "completed", "expired"])("allows a new purchase when subscription state is %s", (status) => {
  expect(hasOpenSubscription(status)).toBe(false);
});
