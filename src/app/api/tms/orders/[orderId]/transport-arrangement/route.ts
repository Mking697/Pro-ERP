import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { OrderError, setTransportArrangedBy } from "@/lib/orders/orders";

const bodySchema = z.object({
  transportArrangedBy: z.enum(["Self", "Party"]),
});

/**
 * Backfills orders.transportArrangedBy for an order created before that column existed
 * (see CLAUDE.md's Order FMS retrofit note) — gated on TMS_FMS since this is TMS's own
 * intake screen surfacing and closing the gap, not a general Order FMS edit.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const guard = await requireModule("TMS_FMS");
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
    const order = await setTransportArrangedBy(orderId, parsed.data.transportArrangedBy, guard.session.userId);
    return NextResponse.json({ order });
  } catch (err) {
    const message = err instanceof OrderError || err instanceof Error ? err.message : "Update nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
