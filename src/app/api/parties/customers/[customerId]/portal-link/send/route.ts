import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { getOrCreatePortalLink } from "@/lib/parties/customerPortal";
import { findById } from "@/db/repo";
import { customers } from "@/db/schema";
import { sendWhatsAppMessage } from "@/lib/chatxflow";

/** Sends the customer their own Portal link over WhatsApp (ChatXFlow) — reuses the exact
 * same send primitive every other module already uses, no new integration. Staff-triggered
 * only (manual button) — there is deliberately no automatic send on order events yet. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ customerId: string }> }
) {
  const guard = await requireModule("PARTY_MASTER");
  if (!guard.ok) return guard.response;

  const { customerId } = await params;
  const id = decodeURIComponent(customerId);
  const customer = await findById(customers, guard.tenant.orgId, id);
  if (!customer) {
    return NextResponse.json({ error: "Customer nahi mila." }, { status: 404 });
  }
  if (!customer.phone) {
    return NextResponse.json({ error: "Is customer ka phone number save nahi hai." }, { status: 400 });
  }

  const token = await getOrCreatePortalLink(id, guard.session.userId);
  const url = `${new URL(request.url).origin}/portal/${token}`;
  const message = `Namaste ${customer.customerName}, aap apne orders aur invoices yahan dekh sakte hain: ${url}`;

  const result = await sendWhatsAppMessage(customer.phone, message);
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "WhatsApp bhej nahi paye." }, { status: 502 });
  }

  return NextResponse.json({ success: true, url });
}
