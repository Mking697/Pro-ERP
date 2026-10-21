import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { regeneratePortalLink } from "@/lib/parties/customerPortal";
import { publicOriginFrom } from "@/lib/publicOrigin";

/** Invalidates the customer's existing Portal link and mints a fresh one — for when a
 * link may have leaked. The old token stops resolving the instant this commits. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ customerId: string }> }
) {
  const guard = await requireModule("PARTY_MASTER");
  if (!guard.ok) return guard.response;

  const { customerId } = await params;
  const token = await regeneratePortalLink(decodeURIComponent(customerId), guard.session.userId);
  const url = `${publicOriginFrom(request)}/portal/${token}`;

  return NextResponse.json({ token, url });
}
