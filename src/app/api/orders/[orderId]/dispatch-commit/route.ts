import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { commitDispatch, OrderError } from "@/lib/orders/orders";

const bodySchema = z.object({
  dispatchCommitDate: z.string().trim().min(1, "Dispatch commit date dena zaroori hai."),
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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const order = await commitDispatch(orderId, parsed.data.dispatchCommitDate, guard.session.userId);
    return NextResponse.json({ order });
  } catch (err) {
    const message = err instanceof OrderError || err instanceof Error ? err.message : "Dispatch commit nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
