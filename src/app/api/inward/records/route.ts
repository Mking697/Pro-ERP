import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { listFailureLog, listImsInward } from "@/lib/inward";
import { tryModule } from "@/lib/moduleSheets";

/**
 * The two sheets a quality check routes into: rejected quantities to the Failure Log,
 * accepted quantities to IMS Inward. Data has always landed there; nothing read it back.
 *
 * Either sheet may be unconnected while the other works, so each is resolved
 * independently rather than failing the whole response.
 */
export async function GET() {
  const guard = await requireModule("IMS_VIEW");
  if (!guard.ok) return guard.response;

  const [failures, ims] = await Promise.all([
    tryModule(() => listFailureLog()),
    tryModule(() => listImsInward()),
  ]);

  return NextResponse.json({
    failures: failures ?? [],
    ims: ims ?? [],
    setupRequired: [
      failures === null ? "Failure Log" : null,
      ims === null ? "IMS - Inward Sub-Sheet" : null,
    ].filter(Boolean),
  });
}
