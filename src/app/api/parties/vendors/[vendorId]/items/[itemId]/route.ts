import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { deleteVendorItem } from "@/lib/parties/vendorItems";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const guard = await requireModule("PARTY_MASTER");
  if (!guard.ok) return guard.response;

  const { itemId } = await params;
  const deleted = await deleteVendorItem(itemId);
  if (!deleted) {
    return NextResponse.json({ error: "Link nahi mila." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
