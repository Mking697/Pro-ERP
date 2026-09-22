import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { followUpShipment, TmsError } from "@/lib/tms/tms";

const bodySchema = z.object({
  note: z.string().trim().optional().default(""),
});

/** Party-arranged flow's own "vehicle hasn't shown up yet" reminder — logs an activity,
 * changes no fields (see followUpShipment()'s own comment). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  const guard = await requireModule("TMS_FMS");
  if (!guard.ok) return guard.response;

  const { shipmentId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    await followUpShipment(shipmentId, parsed.data.note, guard.session.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof TmsError || err instanceof Error ? err.message : "Follow-up nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
