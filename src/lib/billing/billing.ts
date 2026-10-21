import { and, eq, isNull } from "drizzle-orm";
import { billingPayments, billingSubscriptionAttempts, billingSubscriptionCharges, organizations } from "@/db/schema";
import { db, runInTenantTransaction } from "@/db/client";
import { insertRecord, updateById } from "@/db/repo";
import { generateId } from "@/lib/id";
import { getLiveSession } from "@/lib/auth/live-session";
import {
  getPlanPricePaise,
  type BillingCycle,
  type PlanTier,
} from "@/lib/platform/planLimits";
import {
  cancelRazorpaySubscription,
  createRazorpayOrder,
  createRazorpaySubscription,
  getOrCreateRazorpayPlanId,
  razorpayPublicKeyId,
  verifyRazorpaySignature,
} from "@/lib/billing/razorpay";
import { createSubscriptionService, SubscriptionError, type SubscriptionStore } from "./subscriptions";
import { assertSubscriptionsReady, fetchRazorpaySubscription, fetchRazorpayPayment, fetchRazorpayInvoice } from "./razorpay";

/**
 * Self-serve plan purchase via Razorpay Standard Checkout — one order per billing cycle,
 * not a Razorpay Subscription (no auto-debit yet, see billing.ts schema comment). An org's
 * own Admin picks a plan+cycle on `/billing`; the server computes the price itself from
 * `planLimits.ts` (the client never sends an amount, so a tampered request can't
 * under-charge), creates a Razorpay order, and records a `Created` billing_payments row.
 * `verifyAndApplyBillingPayment` is the only place a row flips to `Paid` and the org's own
 * plan actually changes — never trusts the browser's "payment succeeded" callback alone.
 */

export class BillingError extends Error {}

export interface StartCheckoutResult {
  paymentId: string;
  razorpayOrderId: string;
  amountPaise: number;
  currency: string;
  razorpayKeyId: string;
}

function cycleDays(cycle: BillingCycle): number {
  return cycle === "Yearly" ? 365 : 30;
}

async function admitManualCheckout(orgId: string, requireActive: boolean) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org || (requireActive && org.status !== "Active")) throw new BillingError("Organization abhi active nahi hai.");
  const [attempt] = await db.select().from(billingSubscriptionAttempts)
    .where(and(eq(billingSubscriptionAttempts.orgId, orgId), isNull(billingSubscriptionAttempts.closedAt))).limit(1);
  if (attempt || (org.razorpaySubscriptionId && !["cancelled", "completed", "expired"].includes(org.subscriptionStatus))) {
    throw new BillingError("Existing subscription ko pehle cancel/reconcile karein. Doosra payment abhi allowed nahi hai.");
  }
  return org;
}

export async function startPlanCheckout(
  plan: PlanTier,
  cycle: BillingCycle
): Promise<StartCheckoutResult> {
  if (plan === "Trial") {
    throw new BillingError("Trial plan ke liye payment nahi hota.");
  }
  const amountPaise = getPlanPricePaise(plan, cycle);
  if (!amountPaise) {
    throw new BillingError("Is plan/billing-cycle ke liye price set nahi hai.");
  }

  const orgId = await billingOwner();
  const paymentId = generateId("PAY");
  return runInTenantTransaction(orgId, async () => {
    await admitManualCheckout(orgId, true);

  const order = await createRazorpayOrder({
    amountPaise,
    receipt: paymentId,
    notes: { orgId, plan, cycle },
  });

  await insertRecord(billingPayments, {
    id: paymentId,
    orgId,
    plan,
    billingCycle: cycle,
    amount: (amountPaise / 100).toFixed(2),
    currency: order.currency,
    razorpayOrderId: order.id,
    status: "Created",
  });

  // razorpayPublicKeyId lives in razorpay.ts — the API route reads it from here so its
  // own import list stays to one module for this call.
  return {
    paymentId,
    razorpayOrderId: order.id,
    amountPaise: order.amount,
    currency: order.currency,
    razorpayKeyId: razorpayPublicKeyId(),
  };
  });
}

export interface VerifyPaymentInput {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}

/**
 * Verifies the HMAC signature Razorpay's Checkout handler returned, then — only on a real
 * match — marks the matching `billing_payments` row Paid and moves the CALLER'S OWN org
 * onto the purchased plan/cycle, inside one tenant transaction (both writes commit
 * together or neither does). Scoped to the caller's own org via `getTenantOrgId()`, never
 * trusts an org id from the request body — an org cannot pay for or silently activate
 * another org's plan just by replaying a valid-looking order id.
 *
 * Idempotent: a row already `Paid` (a duplicate verify call, e.g. a retried client
 * request) is a safe no-op, not a double-apply.
 */
export async function verifyAndApplyBillingPayment(
  input: VerifyPaymentInput
): Promise<{ plan: string; billingCycle: string; planRenewsAt: Date }> {
  const orgId = await billingOwner();

  const signatureOk = verifyRazorpaySignature(
    input.razorpayOrderId,
    input.razorpayPaymentId,
    input.razorpaySignature
  );
  if (!signatureOk) {
    throw new BillingError("Payment signature match nahi hua — payment verify nahi ho saka.");
  }

  return runInTenantTransaction(orgId, async () => {
  const [row] = await db
    .select()
    .from(billingPayments)
    .where(
      and(
        eq(billingPayments.razorpayOrderId, input.razorpayOrderId),
        eq(billingPayments.orgId, orgId)
      )
    )
    .limit(1);

  if (!row) {
    throw new BillingError("Ye order is organization ka nahi mila.");
  }

  const renewsAt = new Date(
    (row.paidAt ? new Date(row.paidAt).getTime() : Date.now()) +
    cycleDays(row.billingCycle as BillingCycle) * 24 * 60 * 60 * 1000
  );

  if (row.status === "Paid") {
    // Replayed verification of an already-applied payment — report the existing state,
    // don't extend the renewal date a second time.
    return { plan: row.plan, billingCycle: row.billingCycle, planRenewsAt: renewsAt };
  }

  await admitManualCheckout(orgId, false);
    await updateById(billingPayments, orgId, row.id, {
      status: "Paid",
      razorpayPaymentId: input.razorpayPaymentId,
      paidAt: new Date(),
    });
    await db
      .update(organizations)
      .set({
        plan: row.plan,
        billingCycle: row.billingCycle,
        trialEndsAt: null,
        planRenewsAt: renewsAt,
      })
      .where(eq(organizations.id, orgId));

    return { plan: row.plan, billingCycle: row.billingCycle, planRenewsAt: renewsAt };
  });
}

export interface StartSubscriptionResult { subscriptionId: string; razorpayKeyId: string }

// db is the adapter proxy: every query constructed inside lock() uses the same
// transaction connection after the per-org advisory lock (no callback tx argument).
const subscriptionStore: SubscriptionStore = {
  lock: (orgId, work) => runInTenantTransaction(orgId, work),
  org: async orgId => (await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1))[0],
  openAttempt: async orgId => (await db.select().from(billingSubscriptionAttempts).where(and(eq(billingSubscriptionAttempts.orgId, orgId), isNull(billingSubscriptionAttempts.closedAt))).limit(1))[0],
  attempt: async id => (await db.select().from(billingSubscriptionAttempts).where(eq(billingSubscriptionAttempts.id, id)).limit(1))[0],
  byProvider: async id => (await db.select().from(billingSubscriptionAttempts).where(eq(billingSubscriptionAttempts.providerId, id)).limit(1))[0],
  insert: async attempt => { await db.insert(billingSubscriptionAttempts).values(attempt); },
  update: async (id, patch) => { await db.update(billingSubscriptionAttempts).set(patch).where(eq(billingSubscriptionAttempts.id, id)); },
  updateOrg: async (orgId, patch) => { await db.update(organizations).set(patch).where(eq(organizations.id, orgId)); },
  receipt: async (attempt, payment) => {
    const inserted = await db.insert(billingSubscriptionCharges).values({ paymentId: payment.id, attemptId: attempt.id, paidThrough: payment.paidThrough }).onConflictDoNothing().returning({ id: billingSubscriptionCharges.paymentId });
    if (!inserted.length) {
      const [existing] = await db.select().from(billingSubscriptionCharges).where(eq(billingSubscriptionCharges.paymentId, payment.id)).limit(1);
      if (!existing || existing.attemptId !== attempt.id) throw new SubscriptionError("Payment already bound to another subscription.");
      return false;
    }
    await db.insert(billingPayments).values({ id: generateId("PAY"), orgId: attempt.orgId, plan: attempt.plan, billingCycle: attempt.cycle, amount: (attempt.amountPaise / 100).toFixed(2), currency: attempt.currency, razorpayOrderId: payment.orderId, razorpayPaymentId: payment.id, status: "Paid", paidAt: new Date() });
    return true;
  },
};
const subscriptions = createSubscriptionService(subscriptionStore, {
  ready: assertSubscriptionsReady, keyId: razorpayPublicKeyId, plan: getOrCreateRazorpayPlanId,
  create: createRazorpaySubscription, subscription: fetchRazorpaySubscription,
  payment: fetchRazorpayPayment, invoice: fetchRazorpayInvoice, cancel: cancelRazorpaySubscription,
}, () => generateId("SUB"));

/** Explicit org arguments are server-only, taken from requireRole's live Admin session.
 * Legacy internal callers without an argument still resolve a live Admin, never
 * getTenantOrgId (which deliberately refuses an expired trial). */
async function billingOwner(explicitOrgId?: string): Promise<string> {
  if (explicitOrgId) return explicitOrgId;
  const session = await getLiveSession();
  if (!session || session.role !== "Admin") throw new SubscriptionError("Admin session required.", 403);
  return session.orgId;
}
export async function startPlanSubscription(plan: PlanTier, cycle: BillingCycle, orgId?: string): Promise<StartSubscriptionResult> {
  assertSubscriptionsReady();
  return subscriptions.start(await billingOwner(orgId), plan, cycle);
}
export async function cancelPlanSubscription(orgId?: string): Promise<{ status: string }> {
  assertSubscriptionsReady();
  return subscriptions.cancel(await billingOwner(orgId));
}
export interface SubscriptionWebhookPayload { event: string; subscriptionId: string; paymentId?: string }
export async function applySubscriptionWebhookEvent(payload: SubscriptionWebhookPayload): Promise<void> {
  await subscriptions.webhook(payload);
}
