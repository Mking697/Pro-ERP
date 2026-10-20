import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { verifyAndApplyBillingPayment, BillingError } from "@/lib/billing/billing";

/**
 * Verifies a Razorpay Checkout success callback and — only on a genuine signature match —
 * activates the purchased plan for the signed-in org's own Admin's organization. Never
 * trusts `razorpay_payment_id`/`razorpay_order_id` alone; the HMAC-SHA256 signature
 * (src/lib/billing/razorpay.ts's `verifyRazorpaySignature`) is the one real proof.
 */

const bodySchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});

export async function POST(request: Request) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Payment details incomplete hain." }, { status: 400 });
  }

  try {
    const result = await verifyAndApplyBillingPayment({
      razorpayOrderId: parsed.data.razorpay_order_id,
      razorpayPaymentId: parsed.data.razorpay_payment_id,
      razorpaySignature: parsed.data.razorpay_signature,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof BillingError) {
      // Signature mismatch or an order belonging to another org — do NOT mark as paid.
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("billing/verify-payment failed:", error);
    return NextResponse.json(
      { error: "Payment verify nahi ho paaya. Support se sampark karein." },
      { status: 500 }
    );
  }
}
