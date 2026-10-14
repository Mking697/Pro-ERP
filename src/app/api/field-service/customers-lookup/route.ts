import { NextResponse } from "next/server";
import { fieldRoute } from "@/lib/fieldService/api";
import { listCustomers } from "@/lib/parties/customers";

/**
 * Customer picker shared by Services/Complaints/Site Visits — unlike Order FMS's own
 * "my customers only" scoping, this lists every Active customer in the org: field
 * service staff work across the whole Customer Master, not just rows they personally
 * created.
 */
export async function GET() {
  return fieldRoute(["SERVICE_FMS", "COMPLAINT_FMS", "SITE_VISIT_FMS"], true, async () => {

  const all = await listCustomers();
  const active = all.filter((c) => c.Status === "Active");

  return NextResponse.json({
    customers: active.map((c) => ({
      id: c.Customer_ID,
      name: c.Customer_Name,
      phone: c.Phone,
      city: c.City,
      state: c.State,
    })),
  });
  });
}
