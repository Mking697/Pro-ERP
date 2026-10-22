import { NextResponse } from "next/server";
import { getMutationKey, MutationConflictError } from "@/lib/mutations";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { cancelOrder, OrderError } from "@/lib/orders/orders";

const bodySchema = z.object({
  reason: z.string().trim().optional().default(""),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const guard = await requireModule("ORDER_FMS");
  if (!guard.ok) return guard.response;

  const { orderId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  try {
    const order = await cancelOrder(orderId, parsed.data.reason, guard.session.userId, getMutationKey(request));
    return NextResponse.json({ order });
  } catch (err) {
    const message = err instanceof OrderError || err instanceof Error ? err.message : "Order cancel nahi ho paya.";
    return NextResponse.json({ error: message }, { status: err instanceof MutationConflictError ? 409 : 400 });
  }
}
