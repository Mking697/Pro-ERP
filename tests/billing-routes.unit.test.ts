import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
const mocks = vi.hoisted(() => ({ start: vi.fn(), cancel: vi.fn(), apply: vi.fn(), guard: vi.fn() }));
vi.mock("@/lib/auth/guard", () => ({ requireRole: mocks.guard }));
vi.mock("@/lib/billing/billing", () => ({ startPlanSubscription: mocks.start, cancelPlanSubscription: mocks.cancel, applySubscriptionWebhookEvent: mocks.apply, BillingError: class extends Error {} }));
import { POST as webhook } from "@/app/api/webhooks/razorpay/route";
import { POST as start } from "@/app/api/billing/create-subscription/route";
import { POST as cancel } from "@/app/api/billing/cancel-subscription/route";
beforeEach(() => {
  vi.clearAllMocks();
  for (const [k,v] of Object.entries({ RAZORPAY_SUBSCRIPTIONS_ENABLED: "true", RAZORPAY_KEY_ID: "synthetic-key", RAZORPAY_KEY_SECRET: "synthetic-api", RAZORPAY_WEBHOOK_SECRET: "synthetic-webhook" })) vi.stubEnv(k,v);
  mocks.guard.mockResolvedValue({ ok: true, session: { orgId: "expired-trial-org", role: "Admin" } });
  mocks.start.mockResolvedValue({ subscriptionId: "sub_1", razorpayKeyId: "synthetic-key" });
  mocks.cancel.mockResolvedValue({ status: "active" });
});
afterEach(() => vi.unstubAllEnvs());
function signed(raw: string, valid = true) { return new Request("https://example.test/api/webhooks/razorpay", { method: "POST", body: raw, headers: { "x-razorpay-signature": valid ? createHmac("sha256", "synthetic-webhook").update(raw).digest("hex") : "bad" } }); }
it("returns 503 without webhook configuration instead of throwing or calling services", async () => {
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "");
  expect((await webhook(signed("{}"))).status).toBe(503); expect(mocks.apply).not.toHaveBeenCalled();
});
it("returns 400 for signed malformed JSON and malformed relevant payload", async () => {
  expect((await webhook(signed("{"))).status).toBe(400);
  expect((await webhook(signed('{"event":"subscription.charged","payload":{"subscription":{"entity":{"id":"sub_1"}}}}'))).status).toBe(400);
  expect(mocks.apply).not.toHaveBeenCalled();
});
it("rejects invalid HMAC before parsing or any service call", async () => {
  expect((await webhook(signed("{", false))).status).toBe(400); expect(mocks.apply).not.toHaveBeenCalled();
});
it("passes only validated event IDs, never webhook notes/amount/status as entitlement authority", async () => {
  const raw = JSON.stringify({ event: "subscription.charged", payload: { subscription: { entity: { id: "sub_1", status: "active", notes: { plan: "Enterprise" } } }, payment: { entity: { id: "pay_1", amount: 1 } } } });
  expect((await webhook(signed(raw))).status).toBe(200);
  expect(mocks.apply).toHaveBeenCalledWith({ event: "subscription.charged", subscriptionId: "sub_1", paymentId: "pay_1" });
});
it("subscription create and cancel use live guard owner explicitly (expired trials need no tenant admission)", async () => {
  expect((await start(new Request("https://example.test", { method: "POST", body: JSON.stringify({ plan: "Starter", cycle: "Monthly" }) }))).status).toBe(200);
  expect(mocks.start).toHaveBeenCalledWith("Starter", "Monthly", "expired-trial-org");
  expect((await cancel()).status).toBe(200); expect(mocks.cancel).toHaveBeenCalledWith("expired-trial-org");
});
it("disabled subscriptions return 503 for create/cancel without reaching billing", async () => {
  vi.stubEnv("RAZORPAY_SUBSCRIPTIONS_ENABLED", "false");
  expect((await start(new Request("https://example.test", { method: "POST", body: '{"plan":"Starter","cycle":"Monthly"}' }))).status).toBe(503);
  expect((await cancel()).status).toBe(503); expect(mocks.start).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
});
