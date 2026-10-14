import { NextResponse } from "next/server";
import { fieldRoute, jsonObject } from "@/lib/fieldService/api";
import { validateCreate } from "@/lib/fieldService/validation";
import { createComplaint, listComplaints } from "@/lib/fieldService/complaints";
export async function GET() {
  return fieldRoute(["COMPLAINT_FMS"], false, async (session, _orgId, staff) => NextResponse.json({complaints: await listComplaints(staff ? undefined : session.userId)}));
}
export async function POST(request: Request) {
  return fieldRoute(["COMPLAINT_FMS"], true, async (session, orgId) => {
    const input = validateCreate("COMPLAINT", await jsonObject(request), orgId);
    return NextResponse.json({complaint: await createComplaint(input, session.userId)}, {status:201});
  });
}
