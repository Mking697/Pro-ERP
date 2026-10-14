import { NextResponse } from "next/server";
import { fieldRoute } from "@/lib/fieldService/api";
import { listUsers } from "@/lib/auth/users";
import { getDoerOccupancy } from "@/lib/fieldService/assignments";

/** Doer picker for the Assign dialog — every Active user (any role may be assigned
 * field work, there is no dedicated "Doer" role in this codebase) plus what each one is
 * currently occupied on, across all 3 task types, so the dialog can show "Free" vs
 * "Occupied on ...". */
export async function GET() {
  return fieldRoute(["SERVICE_FMS", "COMPLAINT_FMS", "SITE_VISIT_FMS"], true, async (_session, orgId) => {

  const users = (await listUsers()).filter((u) => u.Status === "Active");
  const occupancy = await getDoerOccupancy(orgId, users.map((u) => u.User_ID));

  return NextResponse.json({
    doers: users.map((u) => ({
      id: u.User_ID,
      fullName: u.Full_Name,
      role: u.Role,
      occupied: occupancy.get(u.User_ID) ?? [],
    })),
  });
  });
}
