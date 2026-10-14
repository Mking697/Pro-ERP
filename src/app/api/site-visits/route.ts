import { NextResponse } from "next/server";
import { fieldRoute, jsonObject } from "@/lib/fieldService/api";
import { validateCreate } from "@/lib/fieldService/validation";
import { createSiteVisit, listSiteVisits } from "@/lib/fieldService/siteVisits";
export async function GET() {
  return fieldRoute(["SITE_VISIT_FMS"], false, async (session, _orgId, staff) => NextResponse.json({visits: await listSiteVisits(staff ? undefined : session.userId)}));
}
export async function POST(request: Request) {
  return fieldRoute(["SITE_VISIT_FMS"], true, async (session, orgId) => {
    const input = validateCreate("SITE_VISIT", await jsonObject(request), orgId);
    return NextResponse.json({visit: await createSiteVisit(input, session.userId)}, {status:201});
  });
}
