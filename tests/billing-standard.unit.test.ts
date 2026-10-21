import { beforeEach, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
const state = vi.hoisted(() => ({ patches: [] as Record<string, unknown>[], inserted: vi.fn(), updated: vi.fn(), open: false, tenant: vi.fn(), status: "Active" }));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: state.tenant }));
vi.mock("@/lib/auth/live-session", () => ({ getLiveSession: async () => ({ orgId: "org", role: "Admin" }) }));
vi.mock("@/db/repo", () => ({ insertRecord: state.inserted, updateById: state.updated }));
vi.mock("@/db/client", () => ({
  runInTenantTransaction: async (_org: string, work: () => Promise<unknown>) => work(),
  db: {
    select: () => ({ from: (table: Parameters<typeof getTableName>[0]) => ({ where: () => ({ limit: async () => {
      const name = getTableName(table);
      if (name === "organizations") return [{ id: "org", status: state.status, razorpaySubscriptionId: "", subscriptionStatus: "", planRenewsAt: null }];
      if (name === "billing_subscription_attempts") return state.open ? [{ id: "attempt", status: "reserved" }] : [];
      return [{ id: "payment", plan: "Starter", billingCycle: "Monthly", status: "Created", paidAt: null }];
    } }) }) }),
    update: () => ({ set: (patch: Record<string, unknown>) => { state.patches.push(patch); return { where: async () => [] }; } }),
  },
}));
vi.mock("@/lib/billing/razorpay", () => ({
  verifyRazorpaySignature: () => true, createRazorpayOrder: async () => ({ id: "order_1", amount: 299900, currency: "INR" }), razorpayPublicKeyId: () => "synthetic-key",
  assertSubscriptionsReady: () => { throw new Error("disabled"); }, getOrCreateRazorpayPlanId: vi.fn(), createRazorpaySubscription: vi.fn(), cancelRazorpaySubscription: vi.fn(), fetchRazorpaySubscription: vi.fn(), fetchRazorpayPayment: vi.fn(), fetchRazorpayInvoice: vi.fn(),
}));
import { startPlanCheckout, verifyAndApplyBillingPayment } from "@/lib/billing/billing";
beforeEach(() => {
  vi.clearAllMocks(); state.patches.length = 0; state.open = false; state.status = "Active";
  state.tenant.mockResolvedValue("org");
});
it("permits expired-trial Admin purchase without ordinary tenant admission", async () => {
  state.tenant.mockRejectedValue(new Error("TRIAL_EXPIRED"));
  expect((await startPlanCheckout("Starter", "Monthly")).razorpayOrderId).toBe("order_1");
  await expect(verifyAndApplyBillingPayment({ razorpayOrderId: "order_1", razorpayPaymentId: "pay_1", razorpaySignature: "synthetic" })).resolves.toMatchObject({ plan: "Starter" });
  expect(state.tenant).not.toHaveBeenCalled();
});
it("blocks direct one-time purchase while a subscription attempt is unresolved", async () => {
  state.open = true;
  await expect(startPlanCheckout("Starter", "Monthly")).rejects.toThrow();
  expect(state.inserted).not.toHaveBeenCalled();
});
it("blocks one-time purchase for administratively suspended organizations", async () => {
  state.status = "Suspended";
  await expect(startPlanCheckout("Starter", "Monthly")).rejects.toThrow();
});
it("preserves Standard Checkout even when subscription admission is disabled", async () => {
  const result = await startPlanCheckout("Starter", "Monthly");
  expect(result).toMatchObject({ razorpayOrderId: "order_1", amountPaise: 299900, currency: "INR", razorpayKeyId: "synthetic-key" });
  expect(state.inserted).toHaveBeenCalled();
});
it("Standard payment grants its plan but cannot overwrite an administrative suspension", async () => {
  await verifyAndApplyBillingPayment({ razorpayOrderId: "order_1", razorpayPaymentId: "pay_1", razorpaySignature: "synthetic" });
  expect(state.patches.at(-1)).toMatchObject({ plan: "Starter", billingCycle: "Monthly" });
  expect(state.patches.at(-1)).not.toHaveProperty("status");
});
