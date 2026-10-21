import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { getOrCreatePortalLink } from "@/lib/parties/customerPortal";
import { publicOriginFrom } from "@/lib/publicOrigin";

/** Returns this customer's existing Portal link, or mints one — idempotent, safe to call
 * every time the "Portal Link" dialog opens on the Customer Master board. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ customerId: string }> }
) {
  const guard = await requireModule("PARTY_MASTER");
  if (!guard.ok) return guard.response;

  const { customerId } = await params;
  const token = await getOrCreatePortalLink(decodeURIComponent(customerId), guard.session.userId);
  const url = `${publicOriginFrom(request)}/portal/${token}`;

  return NextResponse.json({ token, url });
}
