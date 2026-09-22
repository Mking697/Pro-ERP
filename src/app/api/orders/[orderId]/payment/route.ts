import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { OrderError, recordPayment } from "@/lib/orders/orders";

const bodySchema = z.object({
  amount: z.coerce.number().positive("Amount 0 se zyada hona chahiye."),
  mode: z.enum(["Cash", "UPI", "Bank_Transfer", "Cheque", "Card", "Other"]),
  reference: z.string().trim().optional(),
  receivedAt: z.string().trim().optional(),
});

/** Record Payment — available at any (non-Cancelled) status, not just Payment_Review. */
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
    const order = await recordPayment(orderId, parsed.data, guard.session.userId);
    return NextResponse.json({ order });
  } catch (err) {
    const message = err instanceof OrderError || err instanceof Error ? err.message : "Payment record nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
