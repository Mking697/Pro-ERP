import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { cancelPlanSubscription, BillingError } from "@/lib/billing/billing";
import { assertSubscriptionsReady } from "@/lib/billing/razorpay";
import { SubscriptionError } from "@/lib/billing/subscriptions";

/**
 * Cancels the signed-in org's own Admin's active Razorpay Subscription — keeps access
 * through the already-paid-for current cycle (`cancelAtCycleEnd = true`, see
 * `cancelPlanSubscription`'s own doc comment), Razorpay simply stops charging again after
 * that. The org's `plan` is left untouched here; only the `subscription.cancelled`
 * webhook, once it actually arrives, is a source of truth for that.
 */
export async function POST() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  try {
    assertSubscriptionsReady();
    const result = await cancelPlanSubscription(guard.session.orgId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SubscriptionError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof BillingError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Subscription cancel nahi ho paayi. Support se sampark karein." },
      { status: 500 }
    );
  }
}
