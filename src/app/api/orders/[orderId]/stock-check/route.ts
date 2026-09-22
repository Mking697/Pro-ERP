import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { OrderError, runStockCheck } from "@/lib/orders/orders";

/** Step 3 — reserves whatever Free FG stock is actually available against this order's own
 * lines, moves it to Dispatch_Pending, and fires the shortfall notify if any line is short. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const guard = await requireModule("ORDER_FMS");
  if (!guard.ok) return guard.response;

  const { orderId } = await params;

  try {
    const order = await runStockCheck(orderId, guard.session.userId);
    return NextResponse.json({ order });
  } catch (err) {
    const message = err instanceof OrderError || err instanceof Error ? err.message : "Stock Check nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
