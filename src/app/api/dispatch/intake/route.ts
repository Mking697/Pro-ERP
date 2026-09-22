import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { listIntakeCandidates } from "@/lib/dispatch/dispatch";

/** Every At_Loading_Dock shipment not yet handed to Dispatch — Dispatch's own candidate
 * intake queue, mirroring TMS's/PDI's/Accounts' own intake endpoints. */
export async function GET() {
  const guard = await requireModule("DISPATCH_FMS");
  if (!guard.ok) return guard.response;

  const candidates = await listIntakeCandidates();
  return NextResponse.json({ candidates });
}
