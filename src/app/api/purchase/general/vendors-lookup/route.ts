import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { listVendors } from "@/lib/parties/vendors";

/**
 * Independent PO's vendor picker — unlike the raw-material PO flow (whose vendor list
 * only ever comes from Approved-indent candidates already linked to supply a given SKU),
 * a General PO can go to ANY Active vendor, so this is a plain, full lookup. Needs only
 * PURCHASE_FMS, not PARTY_MASTER — same reasoning as /api/leads/customers-lookup and
 * /api/parties/vendors/lookup.
 */
export async function GET() {
  const guard = await requireModule("PURCHASE_FMS");
  if (!guard.ok) return guard.response;

  const all = await listVendors();
  const active = all.filter((v) => v.Status === "Active");

  return NextResponse.json({
    vendors: active.map((v) => ({
      id: v.Vendor_ID,
      name: v.Vendor_Name,
      phone: v.Phone,
      city: v.City,
    })),
  });
}
