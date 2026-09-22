import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { OrderError, workPaymentReview } from "@/lib/orders/orders";

/** Works the Payment_Review credit gate — see src/lib/orders/orders.ts for the exact
 * formula. Moves the order to Stock_Check or Credit_Hold, or refuses (no-credit customer
 * with no advance yet). */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const guard = await requireModule("ORDER_FMS");
  if (!guard.ok) return guard.response;

  const { orderId } = await params;

  try {
    const order = await workPaymentReview(orderId, guard.session.userId);
    return NextResponse.json({ order });
  } catch (err) {
    const message = err instanceof OrderError || err instanceof Error ? err.message : "Payment Review nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
