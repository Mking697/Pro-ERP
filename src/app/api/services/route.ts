import { NextResponse } from "next/server";
import { fieldRoute, jsonObject } from "@/lib/fieldService/api";
import { validateCreate } from "@/lib/fieldService/validation";
import { createServiceJob, listServiceJobs } from "@/lib/fieldService/serviceJobs";
export async function GET() {
  return fieldRoute(["SERVICE_FMS"], false, async (session, _orgId, staff) => NextResponse.json({jobs: await listServiceJobs(staff ? undefined : session.userId)}));
}
export async function POST(request: Request) {
  return fieldRoute(["SERVICE_FMS"], true, async (session, orgId) => {
    const input = validateCreate("SERVICE", await jsonObject(request), orgId);
    return NextResponse.json({job: await createServiceJob(input, session.userId)}, {status:201});
  });
}
