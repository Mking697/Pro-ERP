import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { approveCreditHold, OrderError } from "@/lib/orders/orders";

/** Clears a Credit_Hold — enforced inside approveCreditHold() itself: only the org's
 * configured Credit-Hold Approver (Order Setup) or an Admin. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const guard = await requireModule("ORDER_FMS");
  if (!guard.ok) return guard.response;

  const { orderId } = await params;

  try {
    const order = await approveCreditHold(orderId, {
      userId: guard.session.userId,
      role: guard.session.role,
    });
    return NextResponse.json({ order });
  } catch (err) {
    const message = err instanceof OrderError || err instanceof Error ? err.message : "Credit Hold clear nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
