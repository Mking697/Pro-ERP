import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { BILLING_CYCLES, PLAN_TIERS } from "@/lib/platform/planLimits";
import { startPlanSubscription, BillingError } from "@/lib/billing/billing";

/**
 * Starts a real Razorpay Subscription (auto-recurring billing, roadmap item #10) for the
 * signed-in org's own Admin — the `/billing` page's "Subscribe" flow, replacing
 * `/api/billing/create-order`'s one-time-order flow for any org using it from this point
 * on. Returns just enough for the frontend to open Checkout.js in subscription mode: the
 * subscription id and the PUBLIC key id. The actual plan change only happens later, via
 * the `subscription.activated`/`subscription.charged` webhook — never from this route.
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
    const result = await startPlanSubscription(parsed.data.plan, parsed.data.cycle);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BillingError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("billing/create-subscription failed:", error);
    return NextResponse.json(
      { error: "Subscription nahi ban paayi. Thodi der baad dobara try karein." },
      { status: 500 }
    );
  }
}
