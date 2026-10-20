import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { BILLING_CYCLES, PLAN_TIERS } from "@/lib/platform/planLimits";
import { startPlanCheckout, BillingError } from "@/lib/billing/billing";

/**
 * Starts a Razorpay Standard Checkout for the signed-in org's own Admin — creates a real
 * Razorpay order server-side (amount computed from `plan`+`cycle`, never taken from the
 * client) and a `Created` billing_payments row, then hands the frontend just enough to
 * open Checkout.js: the order id, amount/currency (for display) and the PUBLIC key id.
 * The actual plan change only happens later, in /api/billing/verify-payment, after the
 * signature is independently verified.
 */

const bodySchema = z.object({
  // "Trial" is accepted by the shared enum but rejected below — startPlanCheckout() itself
  // also throws on it, this just gives a cleaner 400 instead of a 500.
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
      { error: "Trial plan ke liye payment nahi hota." },
      { status: 400 }
    );
  }

  try {
    const result = await startPlanCheckout(parsed.data.plan, parsed.data.cycle);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BillingError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // A Razorpay API error (bad/expired test keys, network issue) — never leak the raw
    // SDK error (may carry account-identifying details) to the client.
    console.error("billing/create-order failed:", error);
    return NextResponse.json(
      { error: "Razorpay order nahi ban paaya. Thodi der baad dobara try karein." },
      { status: 500 }
    );
  }
}
