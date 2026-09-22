import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { listIntakeCandidates } from "@/lib/orders/orders";

/** Every Accepted quotation not yet punched into an Order — Order FMS's own "candidate
 * intake queue", mirroring Purchase's /api/purchase/candidates. */
export async function GET() {
  const guard = await requireModule("ORDER_FMS");
  if (!guard.ok) return guard.response;

  const candidates = await listIntakeCandidates();
  return NextResponse.json({ candidates });
}
