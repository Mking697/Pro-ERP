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
import { createRazorpayOrder, razorpayPublicKeyId, verifyRazorpaySignature } from "@/lib/billing/razorpay";

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
