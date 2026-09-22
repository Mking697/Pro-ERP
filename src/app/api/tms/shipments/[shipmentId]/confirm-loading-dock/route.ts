import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { confirmLoadingDock, TmsError } from "@/lib/tms/tms";

const bodySchema = z.object({
  vehicleNo: z.string().trim().optional(),
  driverContactNo: z.string().trim().optional(),
});

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
    const shipment = await confirmLoadingDock(shipmentId, parsed.data, guard.session.userId);
    return NextResponse.json({ shipment });
  } catch (err) {
    const message = err instanceof TmsError || err instanceof Error ? err.message : "Confirm nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
