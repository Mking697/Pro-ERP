import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { listCustomers } from "@/lib/parties/customers";

/** Order FMS's own "Existing Customer" picker — scoped to customers THIS user created,
 * same reasoning and shape as /api/leads/customers-lookup. */
export async function GET() {
  const guard = await requireModule("ORDER_FMS");
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
