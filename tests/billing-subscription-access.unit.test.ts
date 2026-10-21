import { expect, it } from "vitest";
import { isSubscriptionAccessExpired } from "@/lib/billing/subscription-access";
const now = new Date("2026-10-21T00:00:00Z");
const paid = { plan: "Starter", razorpaySubscriptionId: "sub_one", planRenewsAt: new Date("2026-10-22T00:00:00Z") };
it("preserves access until paid-through even when auto-renew is cancelled", () => {
  expect(isSubscriptionAccessExpired(paid, now)).toBe(false);
});
it("ends recurring paid access at the paid-through boundary", () => {
  expect(isSubscriptionAccessExpired({ ...paid, planRenewsAt: now }, now)).toBe(true);
});
it("fails closed for a recurring paid tier with no purchased period", () => {
  expect(isSubscriptionAccessExpired({ ...paid, planRenewsAt: null }, now)).toBe(true);
});
it("leaves legacy/manual plans and trial policy untouched", () => {
  expect(isSubscriptionAccessExpired({ ...paid, razorpaySubscriptionId: "", planRenewsAt: null }, now)).toBe(false);
  expect(isSubscriptionAccessExpired({ ...paid, plan: "Trial", planRenewsAt: null }, now)).toBe(false);
});
