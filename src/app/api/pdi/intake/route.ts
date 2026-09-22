import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { listIntakeCandidates } from "@/lib/pdi/pdi";

/** Every Ready_For_PDI order not yet punched into a PDI inspection — PDI's own "candidate
 * intake queue", mirroring Order FMS's own /api/orders/intake. */
export async function GET() {
  const guard = await requireModule("PDI_FMS");
  if (!guard.ok) return guard.response;

  const candidates = await listIntakeCandidates();
  return NextResponse.json({ candidates });
}
