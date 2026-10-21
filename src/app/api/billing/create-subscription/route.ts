import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { BILLING_CYCLES, PLAN_TIERS } from "@/lib/platform/planLimits";
import { startPlanSubscription, BillingError } from "@/lib/billing/billing";
import { assertSubscriptionsReady } from "@/lib/billing/razorpay";
import { SubscriptionError } from "@/lib/billing/subscriptions";

/**
 * Starts a real Razorpay Subscription (auto-recurring billing, roadmap item #10) for the
 * signed-in org's own Admin. Standard Checkout remains available separately.
 * Returns the durable pending subscription id and PUBLIC Checkout key.
 * Only a provider-verified subscription.charged grants the target plan, never activation.
 */

const bodySchema = z.object({
  plan: z.enum(PLAN_TIERS),
  cycle: z.enum(BILLING_CYCLES),
});

export async function POST(request: Request) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  if (parsed.data.plan === "Trial") {
    return NextResponse.json(
      { error: "Trial plan ke liye subscription nahi banta." },
      { status: 400 }
    );
  }

  try {
    assertSubscriptionsReady();
    const result = await startPlanSubscription(parsed.data.plan, parsed.data.cycle, guard.session.orgId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SubscriptionError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof BillingError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Subscription unresolved. Naya subscription banane se pehle support se sampark karein." },
      { status: 500 }
    );
  }
}
