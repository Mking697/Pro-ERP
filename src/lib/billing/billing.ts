import { and, eq } from "drizzle-orm";
import { billingPayments, organizations } from "@/db/schema";
import { db, runInTenantTransaction } from "@/db/client";
import { insertRecord, updateById } from "@/db/repo";
import { generateId } from "@/lib/id";
import { getTenantOrgId } from "@/lib/tenant";
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
import { getOrganization, updateOrganization } from "@/lib/platform/registry";

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

  const orgId = await getTenantOrgId();
  const paymentId = generateId("PAY");

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
  const orgId = await getTenantOrgId();

  const signatureOk = verifyRazorpaySignature(
    input.razorpayOrderId,
    input.razorpayPaymentId,
    input.razorpaySignature
  );
  if (!signatureOk) {
    throw new BillingError("Payment signature match nahi hua — payment verify nahi ho saka.");
  }

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

  const renewsAt = row.paidAt
    ? new Date(row.paidAt)
    : new Date(Date.now() + cycleDays(row.billingCycle as BillingCycle) * 24 * 60 * 60 * 1000);

  if (row.status === "Paid") {
    // Replayed verification of an already-applied payment — report the existing state,
    // don't extend the renewal date a second time.
    return { plan: row.plan, billingCycle: row.billingCycle, planRenewsAt: renewsAt };
  }

  await runInTenantTransaction(orgId, async () => {
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
        status: "Active",
      })
      .where(eq(organizations.id, orgId));
  });

  return { plan: row.plan, billingCycle: row.billingCycle, planRenewsAt: renewsAt };
}

export interface StartSubscriptionResult {
  subscriptionId: string;
  razorpayKeyId: string;
}

/**
 * Starts a real Razorpay Subscription (auto-recurring billing) for the caller's own org —
 * the `/billing` page's "Subscribe" flow. Unlike `startPlanCheckout` above, this doesn't
 * wait for a payment to record anything: `razorpaySubscriptionId`/`subscriptionStatus`
 * are written to the org row IMMEDIATELY (status `"created"`, matching Razorpay's own
 * value for a not-yet-authorized subscription), so the webhook handler always has a row
 * to update by id, with no race between "subscription object exists" and "first webhook
 * event arrives." The actual plan/cycle change only happens later, when the
 * `subscription.activated`/`subscription.charged` webhook confirms a real payment went
 * through — never from this function, and never from the browser's own "Checkout closed
 * successfully" callback.
 */
export async function startPlanSubscription(
  plan: PlanTier,
  cycle: BillingCycle
): Promise<StartSubscriptionResult> {
  if (plan === "Trial") {
    throw new BillingError("Trial plan ke liye subscription nahi banta.");
  }
  if (!getPlanPricePaise(plan, cycle)) {
    throw new BillingError("Is plan/billing-cycle ke liye price set nahi hai.");
  }

  const orgId = await getTenantOrgId();
  const planId = await getOrCreateRazorpayPlanId(plan, cycle);
  const subscription = await createRazorpaySubscription({
    planId,
    notes: { orgId, plan, cycle },
  });

  await updateOrganization(orgId, {
    razorpaySubscriptionId: subscription.id,
    subscriptionStatus: subscription.status,
  });

  return { subscriptionId: subscription.id, razorpayKeyId: razorpayPublicKeyId() };
}

/**
 * Cancels the caller's own org's active Razorpay subscription — scoped to the caller's
 * own org via `getTenantOrgId()` (never trusts a subscription id from the request body),
 * same "an org can only ever touch its own billing" rule as every other function here.
 * `cancelAtCycleEnd = true`: the org keeps access through the cycle it already paid for;
 * Razorpay simply stops charging it again afterwards. The org row's own `plan` is left
 * untouched here — it only changes when the `subscription.cancelled`/`.completed` webhook
 * actually confirms the cycle has ended, same "webhook is the one source of truth, never
 * an optimistic client-driven write" discipline as every other state change in this file.
 */
export async function cancelPlanSubscription(): Promise<{ status: string }> {
  const orgId = await getTenantOrgId();
  const org = await getOrganization(orgId);
  if (!org?.razorpaySubscriptionId) {
    throw new BillingError("Is organization ka koi active subscription nahi mila.");
  }

  const result = await cancelRazorpaySubscription(org.razorpaySubscriptionId, true);
  await updateOrganization(orgId, { subscriptionStatus: result.status });
  return { status: result.status };
}

export interface SubscriptionWebhookPayload {
  event: string;
  subscriptionId: string;
  status: string;
  /** From the Razorpay subscription entity's own `notes.plan`/`notes.cycle` (set once at
   * `startPlanSubscription()`-time) — the TARGET plan/cycle this subscription is actually
   * for. Never read from the org row's current `plan`/`billingCycle`, which still holds
   * whatever the org was on BEFORE this subscription (Trial, or an older paid plan) right
   * up until this webhook applies the change. */
  plan?: string;
  billingCycle?: string;
  /** Unix seconds — Razorpay's `current_end` on the subscription entity. Present on every
   * event this handler cares about except a brand-new `subscription.created` (ignored
   * below, nothing to apply yet). */
  currentEndUnix?: number;
  /** Only present on a `subscription.charged` event's bundled payment entity — used to
   * write a `billing_payments` receipt row, same historical-trail purpose as every
   * Standard Checkout row, so `/billing`'s own payment history (if ever built) has one
   * consistent table to read regardless of which flow paid. */
  paymentId?: string;
  orderId?: string;
  amountPaise?: number;
}

/**
 * Applies ONE already-signature-verified Razorpay webhook event — the one place a
 * subscription's real-world state (an actual successful/failed/cancelled charge) ever
 * changes an org's `plan`/`subscriptionStatus`/`planRenewsAt`. Looked up by
 * `razorpaySubscriptionId` alone (there is no session/org context on an incoming
 * webhook) — `startPlanSubscription` guarantees that id exists on the org row from the
 * moment the subscription was created, before any webhook could possibly arrive.
 *
 * Deliberately does NOT revoke/downgrade an org's plan on `cancelled`/`halted`/
 * `completed`/`expired` — it only records the status. This matches every other billing
 * flow in this codebase today (Standard Checkout's `planRenewsAt` already isn't enforced
 * as a hard cutoff anywhere either) — building real access-revocation on a payment
 * failure is a deliberately separate, higher-stakes decision for a future session, not
 * something to slip in as a side effect of this webhook handler.
 *
 * Idempotent the same way `verifyAndApplyBillingPayment` is: Razorpay retries a webhook
 * delivery on anything other than a 2xx response, so a duplicate `subscription.charged`
 * for an already-recorded `paymentId` must be a safe no-op, not a double-applied renewal.
 */
export async function applySubscriptionWebhookEvent(payload: SubscriptionWebhookPayload): Promise<void> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.razorpaySubscriptionId, payload.subscriptionId))
    .limit(1);
  if (!org) {
    // A subscription this platform never created (or already deleted the org for) —
    // nothing to apply. Not an error: Razorpay doesn't care whether we recognize it.
    return;
  }

  if (payload.paymentId) {
    const [existing] = await db
      .select()
      .from(billingPayments)
      .where(eq(billingPayments.razorpayPaymentId, payload.paymentId))
      .limit(1);
    if (existing) return; // Already applied this exact charge — duplicate webhook delivery.
  }

  const renewsAt = payload.currentEndUnix ? new Date(payload.currentEndUnix * 1000) : org.planRenewsAt;

  await runInTenantTransaction(org.id, async () => {
    const isActivation = payload.event === "subscription.activated" || payload.event === "subscription.charged";

    await updateOrganization(org.id, {
      subscriptionStatus: payload.status,
      ...(isActivation
        ? {
            status: "Active" as const,
            trialEndsAt: null,
            planRenewsAt: renewsAt ?? undefined,
            ...(payload.plan ? { plan: payload.plan } : {}),
            ...(payload.billingCycle ? { billingCycle: payload.billingCycle } : {}),
          }
        : {}),
    });

    if (payload.event === "subscription.charged" && payload.paymentId && payload.plan && payload.billingCycle) {
      await insertRecord(billingPayments, {
        id: generateId("PAY"),
        orgId: org.id,
        plan: payload.plan,
        billingCycle: payload.billingCycle,
        amount: payload.amountPaise ? (payload.amountPaise / 100).toFixed(2) : "0",
        currency: "INR",
        razorpayOrderId: payload.orderId || `sub_charge_${payload.paymentId}`,
        razorpayPaymentId: payload.paymentId,
        status: "Paid",
        paidAt: new Date(),
      });
    }
  });
}
