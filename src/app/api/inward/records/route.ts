import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { listFailureLog, listImsInward } from "@/lib/inward";

/**
 * The two tables a quality check routes into: rejected quantities to the Failure Log,
 * accepted quantities to IMS Inward.
 */
export async function GET() {
  const guard = await requireModule("IMS_VIEW");
  if (!guard.ok) return guard.response;

  const [failures, ims] = await Promise.all([listFailureLog(), listImsInward()]);

  return NextResponse.json({ failures, ims });
}
