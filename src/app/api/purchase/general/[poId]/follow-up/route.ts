import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { GeneralPurchaseOrderError, markGeneralFollowUpDone } from "@/lib/purchase/generalOrders";

const bodySchema = z.object({
  remark: z.string().trim().optional().default(""),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ poId: string }> }
) {
  const guard = await requireModule("PURCHASE_FMS");
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  const { poId } = await params;
  try {
    const order = await markGeneralFollowUpDone(poId, guard.session.userId, parsed.data.remark);
    return NextResponse.json({ order });
  } catch (err) {
    const message =
      err instanceof GeneralPurchaseOrderError || err instanceof Error
        ? err.message
        : "Follow-up save nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
