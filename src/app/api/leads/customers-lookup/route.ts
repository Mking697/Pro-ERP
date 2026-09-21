import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { listCustomers } from "@/lib/parties/customers";

/**
 * A walk-in quotation's "Existing Customer" picker — scoped to customers THIS salesperson
 * created (`Created_By` on the Customer Master), not the whole org's book, matching how the
 * user described it: a salesman builds up their own customer list over time and quotes
 * against it. Needs only LEAD_FMS, not PARTY_MASTER — the same reasoning as every other
 * lookup endpoint in this codebase (e.g. /api/parties/vendors/lookup for Inward): quoting a
 * customer shouldn't require the full Customer Master grant.
 */
export async function GET() {
  const guard = await requireModule("LEAD_FMS");
  if (!guard.ok) return guard.response;

  const all = await listCustomers();
  const mine = all.filter((c) => c.Created_By === guard.session.userId && c.Status === "Active");

  return NextResponse.json({
    customers: mine.map((c) => ({
      id: c.Customer_ID,
      name: c.Customer_Name,
      phone: c.Phone,
      email: c.Email,
      gstin: c.GSTIN,
      city: c.City,
      state: c.State,
      billingAddress: c.Billing_Address,
    })),
  });
}
