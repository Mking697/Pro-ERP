import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { listVendors } from "@/lib/parties/vendors";

/**
 * Minimal vendor list for pickers — id and name only, no bank/GSTIN/contact details.
 *
 * Needs only a session, not PARTY_MASTER: someone recording an inward entry has to name
 * a party without necessarily being allowed to see the full Vendor Master (mirrors
 * /api/inventory/lookup's reasoning for items).
 */
export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const vendors = await listVendors();

  return NextResponse.json({
    vendors: vendors
      .filter((v) => v.Status === "Active")
      .map((v) => ({ id: v.Vendor_ID, name: v.Vendor_Name })),
  });
}
