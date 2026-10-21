import { z } from "zod";
import { getPlanPricePaise, type PlanTier, type BillingCycle } from "@/lib/platform/planLimits";

export class SubscriptionError extends Error {
  constructor(message: string, public readonly status = 409) { super(message); }
}
export interface SubscriptionAttempt {
  id: string; orgId: string; plan: string; cycle: string; amountPaise: number; currency: string;
  keyId: string; providerPlanId: string | null; providerId: string | null; status: string; closedAt: Date | null;
}
export interface SubscriptionOrg {
  id: string; status: string; razorpaySubscriptionId: string | null; planRenewsAt: Date | null;
}
export interface SubscriptionStore {
  lock<T>(orgId: string, work: () => Promise<T>): Promise<T>;
  org(orgId: string): Promise<SubscriptionOrg | undefined>;
  openAttempt(orgId: string): Promise<SubscriptionAttempt | undefined>;
  attempt(id: string): Promise<SubscriptionAttempt | undefined>;
  byProvider(id: string): Promise<SubscriptionAttempt | undefined>;
  insert(attempt: SubscriptionAttempt): Promise<void>;
  update(id: string, patch: Partial<SubscriptionAttempt>): Promise<void>;
  updateOrg(orgId: string, patch: { razorpaySubscriptionId?: string; subscriptionStatus?: string; plan?: string; billingCycle?: string; trialEndsAt?: null; planRenewsAt?: Date }): Promise<void>;
  receipt(attempt: SubscriptionAttempt, payment: { id: string; orderId: string; paidThrough: Date }): Promise<boolean>;
}
export interface SubscriptionProvider {
  ready(): void;
  keyId(): string;
  plan(plan: PlanTier, cycle: BillingCycle): Promise<string>;
  create(input: { planId: string; notes: Record<string, string> }): Promise<{ id: string; status: string }>;
  subscription(id: string): Promise<unknown>;
  payment(id: string): Promise<unknown>;
  invoice(id: string): Promise<unknown>;
  cancel(id: string, atCycleEnd: boolean): Promise<{ id: string; status: string }>;
}

export function createSubscriptionService(store: SubscriptionStore, provider: SubscriptionProvider, id: () => string) {
  return {
    async webhook(input: { event: string; subscriptionId: string; paymentId?: string }) {
      provider.ready();
      // Discovery only; all authoritative provider reads and writes happen under the org lock.
      let found = await store.byProvider(input.subscriptionId);
      if (!found) {
        const current = subscriptionSchema.parse(await provider.subscription(input.subscriptionId));
        found = await store.attempt(current.notes.attemptId);
        if (!found) throw new SubscriptionError("Unmapped subscription requires reconciliation.", 503);
      }
      const owner = found;
      await store.lock(owner.orgId, async () => {
        const saved = await store.attempt(owner.id);
        if (!saved || saved.keyId !== provider.keyId()) throw new SubscriptionError("Subscription key mismatch.");
        const current = subscriptionSchema.parse(await provider.subscription(input.subscriptionId));
        const attempt = { ...saved, providerId: saved.providerId ?? input.subscriptionId };
        validateSubscription(attempt, current);
        let charge: { id: string; orderId: string; paidThrough: Date } | undefined;
        if (input.event === "subscription.charged") {
          if (!input.paymentId) throw new SubscriptionError("Missing charged payment.", 400);
          const payment = paymentSchema.parse(await provider.payment(input.paymentId));
          const invoice = invoiceSchema.parse(await provider.invoice(payment.invoice_id));
          if (payment.id !== input.paymentId || payment.amount !== attempt.amountPaise || payment.currency !== attempt.currency ||
              invoice.id !== payment.invoice_id || invoice.subscription_id !== input.subscriptionId || invoice.payment_id !== payment.id ||
              invoice.order_id !== payment.order_id || invoice.amount !== attempt.amountPaise || invoice.amount_paid !== attempt.amountPaise || invoice.currency !== attempt.currency || invoice.billing_end <= invoice.billing_start) {
            throw new SubscriptionError("Charge amount, currency or subscription binding mismatch.");
          }
          charge = { id: payment.id, orderId: payment.order_id, paidThrough: new Date(invoice.billing_end * 1000) };
        }
        // A terminal subscription never reopens, even if a stale provider replica responds.
        const status = terminal.has(saved.status) ? saved.status : current.status;
        await store.update(attempt.id, { providerId: attempt.providerId, status, closedAt: terminal.has(status) ? (saved.closedAt ?? new Date()) : null });
        const org = await store.org(attempt.orgId);
        if (!org) throw new SubscriptionError("Organization not found.");
        const open = await store.openAttempt(attempt.orgId);
        const ownsCurrent = org.razorpaySubscriptionId === input.subscriptionId || ((!org.razorpaySubscriptionId || open?.id === attempt.id) && (!open || open.id === attempt.id));
        if (ownsCurrent) await store.updateOrg(attempt.orgId, { razorpaySubscriptionId: input.subscriptionId, subscriptionStatus: status });
        if (charge && await store.receipt(attempt, charge)) {
          // Historical receipts remain durable but may never replace a newer subscription's plan.
          if (ownsCurrent && (!org.planRenewsAt || charge.paidThrough > org.planRenewsAt)) {
            await store.updateOrg(attempt.orgId, { plan: attempt.plan, billingCycle: attempt.cycle, trialEndsAt: null, planRenewsAt: charge.paidThrough });
          }
        }
      });
    },
    async cancel(orgId: string) {
      provider.ready();
      return store.lock(orgId, async () => {
        const org = await store.org(orgId);
        if (!org?.razorpaySubscriptionId) throw new SubscriptionError("No subscription found.", 400);
        const attempt = await store.byProvider(org.razorpaySubscriptionId);
        if (!attempt || attempt.keyId !== provider.keyId()) throw new SubscriptionError("Subscription requires reconciliation.");
        await provider.cancel(org.razorpaySubscriptionId, true);
        const current = subscriptionSchema.parse(await provider.subscription(org.razorpaySubscriptionId));
        validateSubscription(attempt, current);
        const status = terminal.has(attempt.status) ? attempt.status : current.status;
        await store.update(attempt.id, { status, closedAt: terminal.has(status) ? (attempt.closedAt ?? new Date()) : null });
        await store.updateOrg(orgId, { subscriptionStatus: status });
        return { status };
      });
    },
    async start(orgId: string, plan: PlanTier, cycle: BillingCycle) {
      provider.ready();
      const amountPaise = getPlanPricePaise(plan, cycle);
      if (!amountPaise) throw new SubscriptionError("Invalid subscription plan.", 400);
      const admission = await store.lock(orgId, async () => {
        const org = await store.org(orgId);
        if (!org || org.status !== "Active") throw new SubscriptionError("Organization suspended or unavailable.", 403);
        const existing = await store.openAttempt(orgId);
        if (existing) {
          if (terminal.has(existing.status)) throw new SubscriptionError("Existing terminal subscription requires reconciliation.");
          if (existing.plan !== plan || existing.cycle !== cycle || existing.amountPaise !== amountPaise || existing.keyId !== provider.keyId()) {
            throw new SubscriptionError("Existing subscription must be reconciled/cancelled before changing plans.");
          }
          if (!existing.providerId) throw new SubscriptionError("Subscription creation unresolved; contact support. Do not retry creation.");
          const current = subscriptionSchema.parse(await provider.subscription(existing.providerId));
          validateSubscription(existing, current);
          if (!["created", "authenticated"].includes(current.status)) throw new SubscriptionError("Existing subscription is not pending checkout.");
          return { reuse: existing.providerId };
        }
        // Pre-V1 subscriptions cannot be silently replaced; operator reconciliation is required.
        if (org.razorpaySubscriptionId) {
          const previous = await store.byProvider(org.razorpaySubscriptionId);
          if (!previous?.closedAt) throw new SubscriptionError("Existing subscription requires reconciliation.");
        }
        const attempt: SubscriptionAttempt = { id: id(), orgId, plan, cycle, amountPaise, currency: "INR", keyId: provider.keyId(), providerPlanId: null, providerId: null, status: "reserved", closedAt: null };
        await store.insert(attempt);
        return { attempt };
      });
      if (admission.reuse) return { subscriptionId: admission.reuse, razorpayKeyId: provider.keyId() };
      const attempt = admission.attempt!;
      // The committed reservation survives every timeout/crash below. Never automatically retry a create.
      const planId = await provider.plan(plan, cycle);
      await store.lock(orgId, () => store.update(attempt.id, { providerPlanId: planId }));
      let result: { id: string; status: string };
      try { result = await provider.create({ planId, notes: { attemptId: attempt.id, orgId } }); }
      catch { throw new SubscriptionError("Subscription creation unresolved; contact support. Automatic recreation is blocked.", 503); }
      await store.lock(orgId, async () => {
        const saved = await store.attempt(attempt.id);
        if (!saved || (saved.providerId && saved.providerId !== result.id)) throw new SubscriptionError("Subscription identity conflict.");
        // A webhook may have already reconciled this attempt. Never overwrite its newer status.
        if (!saved.providerId) await store.update(attempt.id, { providerId: result.id, status: result.status });
        const org = await store.org(orgId);
        if (!org?.razorpaySubscriptionId || org.razorpaySubscriptionId === result.id || (await store.openAttempt(orgId))?.id === attempt.id) {
          await store.updateOrg(orgId, { razorpaySubscriptionId: result.id, subscriptionStatus: saved.providerId ? saved.status : result.status });
        }
      });
      return { subscriptionId: result.id, razorpayKeyId: provider.keyId() };
    },
  };
}

// Provider responses are untrusted input too. passthrough permits documented extra fields,
// but every field used for money, ownership and entitlement is strictly typed.
const terminal = new Set(["cancelled", "completed", "expired"]);
const providerId = z.string().min(1);
const money = z.number().int().positive().safe();
const unix = z.number().int().positive().max(253402300799);
const paymentSchema = z.object({ id: providerId, status: z.literal("captured"), captured: z.literal(true), amount: money, currency: z.literal("INR"), invoice_id: providerId, order_id: providerId, amount_refunded: z.literal(0) }).passthrough();
const invoiceSchema = z.object({ id: providerId, status: z.literal("paid"), subscription_id: providerId, payment_id: providerId, order_id: providerId, amount: money, amount_paid: money, amount_due: z.literal(0), currency: z.literal("INR"), billing_start: unix, billing_end: unix }).passthrough();
const subscriptionSchema = z.object({ id: providerId, plan_id: providerId, status: z.enum(["created", "authenticated", "active", "pending", "halted", "cancelled", "completed", "expired", "paused"]), quantity: z.literal(1), notes: z.object({ attemptId: providerId, orgId: providerId }).passthrough() }).passthrough();
function validateSubscription(a: SubscriptionAttempt, s: z.infer<typeof subscriptionSchema>) {
  if (s.id !== a.providerId || s.plan_id !== a.providerPlanId || s.notes.attemptId !== a.id || s.notes.orgId !== a.orgId) throw new SubscriptionError("Provider subscription binding mismatch.");
}
