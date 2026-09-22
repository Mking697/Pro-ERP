import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { planShipment, TmsError } from "@/lib/tms/tms";

const bodySchema = z.object({
  transportVendorId: z.string().trim().optional(),
  vehicleSize: z.string().trim().optional(),
  vehiclePrice: z.coerce.number().nonnegative().optional(),
  fromWarehouse: z.string().trim().optional(),
  toAddress: z.string().trim().optional(),
  vehicleNo: z.string().trim().optional(),
  driverContactNo: z.string().trim().optional(),
  items: z
    .array(z.object({ sku: z.string().trim().min(1), qty: z.coerce.number().positive() }))
    .min(1, "Kam se kam ek line allocate karein."),
});

/** Plans one shipment (Self or Party — see planShipment()'s own header comment for how it
 * branches on the order's transportArrangedBy). */
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
    const shipment = await planShipment(orderId, parsed.data, guard.session.userId);
    return NextResponse.json({ shipment });
  } catch (err) {
    const message = err instanceof TmsError || err instanceof Error ? err.message : "Shipment ban nahi paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
