import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { listIntakeCandidates } from "@/lib/tms/tms";

/** Every order whose PDI has Passed and isn't yet fully shipped — TMS's own candidate
 * intake queue, mirroring PDI's/Order FMS's own intake endpoints. */
export async function GET() {
  const guard = await requireModule("TMS_FMS");
  if (!guard.ok) return guard.response;

  const candidates = await listIntakeCandidates();
  return NextResponse.json({ candidates });
}
