import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { markFollowUpDone, PurchaseOrderError } from "@/lib/purchase/orders";

const bodySchema = z.object({
  remark: z.string().trim().optional().default(""),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ poId: string }> }
) {
  const guard = await requireModule("PURCHASE_FMS");
  if (!guard.ok) return guard.response;

  const { poId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  try {
    const order = await markFollowUpDone(poId, guard.session.userId, parsed.data.remark);
    return NextResponse.json({ order });
  } catch (err) {
    const message =
      err instanceof PurchaseOrderError || err instanceof Error
        ? err.message
        : "Follow-up save nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
