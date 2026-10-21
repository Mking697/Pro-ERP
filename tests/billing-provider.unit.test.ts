import { afterEach, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { assertSubscriptionsReady, verifyRazorpayWebhookSignature, razorpayPlanCacheKey } from "@/lib/billing/razorpay";
afterEach(() => vi.unstubAllEnvs());
it("subscriptions fail closed unless explicitly enabled and every key/secret is configured", () => {
  for (const key of ["RAZORPAY_SUBSCRIPTIONS_ENABLED", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"]) vi.stubEnv(key, "");
  expect(assertSubscriptionsReady).toThrow();
  vi.stubEnv("RAZORPAY_SUBSCRIPTIONS_ENABLED", "true"); vi.stubEnv("RAZORPAY_KEY_ID", "synthetic-key"); vi.stubEnv("RAZORPAY_KEY_SECRET", "synthetic-api-secret");
  expect(assertSubscriptionsReady).toThrow();
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "synthetic-webhook-secret"); expect(assertSubscriptionsReady).not.toThrow();
});
it("checks exact raw HMAC and rejects malformed signature without throwing on missing secret", () => {
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", "synthetic-secret");
  const raw = '{ "event": "subscription.charged" }'; const hmac = createHmac("sha256", "synthetic-secret").update(raw).digest("hex");
  expect(verifyRazorpayWebhookSignature(raw, hmac)).toBe(true);
  expect(verifyRazorpayWebhookSignature(JSON.stringify(JSON.parse(raw)), hmac)).toBe(false);
  expect(verifyRazorpayWebhookSignature(raw, "zz".repeat(32))).toBe(false);
  vi.stubEnv("RAZORPAY_WEBHOOK_SECRET", ""); expect(verifyRazorpayWebhookSignature(raw, hmac)).toBe(false);
});
it("plan cache identity binds key, price, tier, cycle and currency without secrets", () => {
  const a = razorpayPlanCacheKey("key-A", "Starter", "Monthly", 299900);
  expect(a).not.toBe(razorpayPlanCacheKey("key-B", "Starter", "Monthly", 299900));
  expect(a).not.toBe(razorpayPlanCacheKey("key-A", "Starter", "Monthly", 300000));
  expect(a).not.toBe(razorpayPlanCacheKey("key-A", "Starter", "Yearly", 299900));
});
