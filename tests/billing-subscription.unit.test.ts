import { describe, it, expect } from "vitest";
import * as schema from "@/db/schema/billing";
import { getTableConfig } from "drizzle-orm/pg-core";
import { createSubscriptionService, type SubscriptionAttempt, type SubscriptionStore, type SubscriptionProvider } from "@/lib/billing/subscriptions";

function fixture() {
  const org = { id: "org", status: "Active", razorpaySubscriptionId: null as string | null, planRenewsAt: null as Date | null, plan: "Trial", billingCycle: "", trialEndsAt: new Date(0), subscriptionStatus: "" };
  const attempts: SubscriptionAttempt[] = [];
  let tail = Promise.resolve(); let creates = 0; let fail = false;
  const receipts = new Set<string>();
  const store: SubscriptionStore = {
    lock: async (_id, work) => {
      const prev = tail; let release!: () => void; tail = new Promise(r => { release = r; }); await prev;
      const before = structuredClone({ org, attempts, receipts });
      try { return await work(); }
      catch (error) { Object.assign(org, before.org); attempts.splice(0, attempts.length, ...before.attempts); receipts.clear(); for (const r of before.receipts) receipts.add(r); throw error; }
      finally { release(); }
    },
    org: async () => ({ ...org }),
    openAttempt: async () => attempts.find(a => !a.closedAt),
    attempt: async id => attempts.find(a => a.id === id),
    byProvider: async id => attempts.find(a => a.providerId === id),
    insert: async a => { attempts.push({ ...a }); },
    update: async (id, patch) => { Object.assign(attempts.find(a => a.id === id)!, patch); },
    updateOrg: async (_id, patch) => { Object.assign(org, patch); },
    receipt: async (_a, p) => { if (receipts.has(p.id)) return false; receipts.add(p.id); return true; },
  };
  const provider: SubscriptionProvider = {
    keyId: () => "test-key", ready: () => {}, plan: async () => "plan_1",
    create: async () => { creates++; expect(attempts[0].providerPlanId).toBe("plan_1"); if (fail) throw new Error("timeout"); return { id: "sub_1", status: "created" }; },
    subscription: async () => ({ id: "sub_1", status: "created", plan_id: "plan_1", quantity: 1, notes: { attemptId: attempts[0]?.id, orgId: "org" } }),
    payment: async () => ({}), invoice: async () => ({}), cancel: async () => ({ id: "sub_1", status: "cancelled" }),
  };
  const service = createSubscriptionService(store, provider, () => `attempt-${attempts.length}`);
  return { service, org, attempts, receipts, provider, store, creates: () => creates, fail: () => { fail = true; } };
}

describe("durable subscription admission", () => {
  it("does not retry an ambiguous provider creation and persists the reservation", async () => {
    const f = fixture(); f.fail();
    await expect(f.service.start("org", "Starter", "Monthly")).rejects.toThrow("unresolved");
    await expect(f.service.start("org", "Starter", "Monthly")).rejects.toThrow("unresolved");
    expect(f.creates()).toBe(1); expect(f.attempts[0].providerPlanId).toBe("plan_1");
  });
  it("blocks different plans and active subscriptions without replacing them", async () => {
    const f = fixture(); await f.service.start("org", "Starter", "Monthly");
    await expect(f.service.start("org", "Growth", "Monthly")).rejects.toThrow("Existing subscription");
    f.provider.subscription = async () => ({ id: "sub_1", plan_id: "plan_1", quantity: 1, status: "active", notes: { attemptId: f.attempts[0].id, orgId: "org" } });
    await expect(f.service.start("org", "Starter", "Monthly")).rejects.toThrow("not pending"); expect(f.creates()).toBe(1);
  });
  it("refuses suspended organizations but admits expired trial organizations", async () => {
    const f = fixture(); f.org.status = "Suspended";
    await expect(f.service.start("org", "Starter", "Monthly")).rejects.toThrow("suspended");
    expect(f.creates()).toBe(0); expect(f.attempts).toHaveLength(0);
    f.org.status = "Active";
    await f.service.start("org", "Starter", "Monthly"); expect(f.creates()).toBe(1);
  });
  it("cancel is serialized and records provider-current status without changing paid access", async () => {
    const f = fixture(); await f.service.start("org", "Starter", "Monthly");
    const result = await f.service.cancel("org");
    expect(result.status).toBe("created"); expect(f.org.subscriptionStatus).toBe("created"); expect(f.org.plan).toBe("Trial");
  });
  it("reserves before creation and reuses the same pending tier under concurrent admission", async () => {
    const f = fixture();
    const first = await f.service.start("org", "Starter", "Monthly");
    const results = await Promise.all([f.service.start("org", "Starter", "Monthly"), f.service.start("org", "Starter", "Monthly")]);
    expect(results).toEqual([first, first]); expect(f.creates()).toBe(1); expect(f.attempts).toHaveLength(1);
    expect(f.attempts[0]).toMatchObject({ orgId: "org", plan: "Starter", cycle: "Monthly", amountPaise: 299900, providerId: "sub_1", keyId: "test-key" });
    expect(f.org.plan).toBe("Trial");
  });
});

describe("verified subscription lifecycle", () => {
  it("grants only verified captured invoice-bound charges, dedupes and preserves suspension", async () => {
    const f = fixture(); await f.service.start("org", "Starter", "Monthly");
    f.org.status = "Suspended";
    f.provider.payment = async () => ({ id: "pay_1", status: "captured", captured: true, amount: 299900, currency: "INR", invoice_id: "inv_1", order_id: "order_1", amount_refunded: 0 });
    f.provider.invoice = async () => ({ id: "inv_1", status: "paid", subscription_id: "sub_1", payment_id: "pay_1", order_id: "order_1", amount: 299900, amount_paid: 299900, amount_due: 0, currency: "INR", billing_start: 100, billing_end: 200 });
    await Promise.all([f.service.webhook({ event: "subscription.charged", subscriptionId: "sub_1", paymentId: "pay_1" }), f.service.webhook({ event: "subscription.charged", subscriptionId: "sub_1", paymentId: "pay_1" })]);
    expect(f.org).toMatchObject({ plan: "Starter", status: "Suspended", planRenewsAt: new Date(200000) }); expect(f.receipts.size).toBe(1);
    f.provider.payment = async () => ({ id: "pay_2", status: "captured", captured: true, amount: 299900, currency: "INR", invoice_id: "inv_2", order_id: "order_2", amount_refunded: 0 });
    f.provider.invoice = async () => ({ id: "inv_2", status: "paid", subscription_id: "sub_1", payment_id: "pay_2", order_id: "order_2", amount: 299900, amount_paid: 299900, amount_due: 0, currency: "INR", billing_start: 50, billing_end: 100 });
    await f.service.webhook({ event: "subscription.charged", subscriptionId: "sub_1", paymentId: "pay_2" });
    expect(f.org.planRenewsAt).toEqual(new Date(200000)); expect(f.receipts.size).toBe(2);
  });
  it("activation records provider-current status but grants no plan or paid access", async () => {
    const f = fixture(); await f.service.start("org", "Starter", "Monthly");
    f.org.status = "Suspended";
    await f.service.webhook({ event: "subscription.activated", subscriptionId: "sub_1" });
    expect(f.org).toMatchObject({ plan: "Trial", status: "Suspended", planRenewsAt: null });
    expect(f.receipts.size).toBe(0);
  });
});

it("has durable open-attempt and provider/payment uniqueness independent of organization pointer", () => {
  const attempts = getTableConfig(schema.billingSubscriptionAttempts);
  expect(attempts.indexes.some(i => i.config.unique && i.config.name === "billing_subscription_one_open_org")).toBe(true);
  expect(schema.billingSubscriptionCharges.paymentId.primary).toBe(true);
});

it("terminal cancellation cannot be reactivated by an older activation event or provider replica", async () => {
  const f = fixture(); await f.service.start("org", "Starter", "Monthly");
  const current = (status: string) => ({ id: "sub_1", status, plan_id: "plan_1", quantity: 1, notes: { attemptId: f.attempts[0].id, orgId: "org" } });
  f.provider.subscription = async () => current("cancelled");
  await f.service.webhook({ event: "subscription.cancelled", subscriptionId: "sub_1" });
  f.provider.subscription = async () => current("active");
  await f.service.webhook({ event: "subscription.activated", subscriptionId: "sub_1" });
  expect(f.org.subscriptionStatus).toBe("cancelled"); expect(f.org.plan).toBe("Trial");
  await f.service.cancel("org");
  expect(f.org.subscriptionStatus).toBe("cancelled");
});
it("a webhook recovers provider creation whose response was lost using durable attempt notes", async () => {
  const f = fixture(); f.fail(); await expect(f.service.start("org", "Starter", "Monthly")).rejects.toThrow();
  expect(f.attempts[0].providerId).toBeNull();
  await f.service.webhook({ event: "subscription.authenticated", subscriptionId: "sub_1" });
  expect(f.attempts[0].providerId).toBe("sub_1"); expect(f.org.razorpaySubscriptionId).toBe("sub_1");
  await f.service.start("org", "Starter", "Monthly"); expect(f.creates()).toBe(1);
});
it("setup validates configuration offline and never returns the secret", async () => {
  const { validateWebhookSetup } = await import("../scripts/setup-razorpay-webhook");
  expect(() => validateWebhookSetup("http://example.test", { enabled: "true", keyId: "synthetic", keySecret: "synthetic", webhookSecret: "do-not-print" })).toThrow();
  const lines = validateWebhookSetup("https://example.test", { enabled: "true", keyId: "synthetic", keySecret: "synthetic", webhookSecret: "do-not-print" });
  expect(lines.join("\n")).toContain("Dashboard"); expect(lines.join("\n")).not.toContain("do-not-print");
});

function verifiedCharge(f: ReturnType<typeof fixture>) {
  const payment = { id: "pay_1", status: "captured", captured: true, amount: 299900, currency: "INR", invoice_id: "inv_1", order_id: "order_1", amount_refunded: 0 };
  const invoice = { id: "inv_1", status: "paid", subscription_id: "sub_1", payment_id: "pay_1", order_id: "order_1", amount: 299900, amount_paid: 299900, amount_due: 0, currency: "INR", billing_start: 100, billing_end: 200 };
  f.provider.payment = async () => payment; f.provider.invoice = async () => invoice;
  return { payment, invoice };
}
for (const [field, value] of [["status", "authorized"], ["captured", false], ["amount", 1], ["currency", "USD"], ["amount_refunded", 1], ["id", "pay_foreign"], ["invoice_id", "inv_foreign"]] as const) {
  it(`refuses invalid fetched payment ${field} before granting or recording a receipt`, async () => {
    const f = fixture(); await f.service.start("org", "Starter", "Monthly"); const { payment } = verifiedCharge(f);
    Object.assign(payment, { [field]: value });
    await expect(f.service.webhook({ event: "subscription.charged", subscriptionId: "sub_1", paymentId: "pay_1" })).rejects.toThrow();
    expect(f.org.plan).toBe("Trial"); expect(f.receipts.size).toBe(0);
  });
}
for (const [field, value] of [["status", "issued"], ["subscription_id", "sub_foreign"], ["payment_id", "pay_foreign"], ["order_id", "order_foreign"], ["amount", 1], ["amount_paid", 1], ["amount_due", 1], ["currency", "USD"], ["billing_end", 50]] as const) {
  it(`refuses invalid fetched invoice ${field}`, async () => {
    const f = fixture(); await f.service.start("org", "Starter", "Monthly"); const { invoice } = verifiedCharge(f);
    Object.assign(invoice, { [field]: value });
    await expect(f.service.webhook({ event: "subscription.charged", subscriptionId: "sub_1", paymentId: "pay_1" })).rejects.toThrow();
    expect(f.org.plan).toBe("Trial"); expect(f.receipts.size).toBe(0);
  });
}
it("historical delayed charges remain receipts but cannot replace a newer subscription plan/status", async () => {
  const f = fixture(); await f.service.start("org", "Starter", "Monthly"); verifiedCharge(f);
  f.attempts[0].status = "cancelled"; f.attempts[0].closedAt = new Date();
  f.org.razorpaySubscriptionId = "sub_new"; f.org.plan = "Growth"; f.org.subscriptionStatus = "active";
  f.org.planRenewsAt = new Date(100000);
  await f.service.webhook({ event: "subscription.charged", subscriptionId: "sub_1", paymentId: "pay_1" });
  expect(f.receipts.size).toBe(1); expect(f.org).toMatchObject({ plan: "Growth", subscriptionStatus: "active", razorpaySubscriptionId: "sub_new", planRenewsAt: new Date(100000) });
});
it("rolls back receipt and status together when entitlement persistence fails (transactional fake)", async () => {
  const f = fixture(); await f.service.start("org", "Starter", "Monthly"); verifiedCharge(f);
  const update = f.store.updateOrg;
  f.store.updateOrg = async (orgId, patch) => { if (patch.plan) throw new Error("write failed"); await update(orgId, patch); };
  await expect(f.service.webhook({ event: "subscription.charged", subscriptionId: "sub_1", paymentId: "pay_1" })).rejects.toThrow("write failed");
  expect(f.receipts.size).toBe(0); expect(f.org.plan).toBe("Trial"); expect(f.org.planRenewsAt).toBeNull();
});
it("rejects provider subscription plan/ownership mismatch", async () => {
  const f = fixture(); await f.service.start("org", "Starter", "Monthly");
  f.provider.subscription = async () => ({ id: "sub_1", plan_id: "plan_foreign", status: "active", quantity: 1, notes: { attemptId: f.attempts[0].id, orgId: "org" } });
  await expect(f.service.webhook({ event: "subscription.activated", subscriptionId: "sub_1" })).rejects.toThrow("binding mismatch");
  expect(f.org.plan).toBe("Trial");
});
it("never reopens a terminal subscription for pending checkout reuse", async () => {
  const f = fixture(); await f.service.start("org", "Starter", "Monthly");
  f.attempts[0].status = "cancelled";
  await expect(f.service.start("org", "Starter", "Monthly")).rejects.toThrow("terminal");
  expect(f.creates()).toBe(1);
});

it("ambiguous provider failure returns a controlled reconciliation-required 503", async () => {
  const f = fixture(); f.fail();
  await expect(f.service.start("org", "Starter", "Monthly")).rejects.toMatchObject({ status: 503 });
  expect(f.creates()).toBe(1); expect(f.attempts).toHaveLength(1);
});
