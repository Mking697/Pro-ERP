import { NextResponse } from "next/server";
import { fieldRoute, forbidden } from "@/lib/fieldService/api";
import { getSiteVisit, listSiteVisitActivities } from "@/lib/fieldService/siteVisits";
import { isTaskAssignedToDoer } from "@/lib/fieldService/assignments";
import { getTaskHistory } from "@/lib/fieldService/steps";
export async function GET(_request: Request, {params}: {params: Promise<{id:string}>}) {
  return fieldRoute(["SITE_VISIT_FMS"], false, async (session, orgId, staff) => {
    const {id} = await params;
    if (!staff && !(await isTaskAssignedToDoer(orgId, "SITE_VISIT", id, session.userId))) return forbidden();
    const visit = await getSiteVisit(id);
    if (!visit) return NextResponse.json({error:"Task nahi mila."}, {status:404});
    const history = await getTaskHistory(orgId, "SITE_VISIT", id, staff ? undefined : session.userId);
    // Activity text can include later rounds: doers use only their authorized round history.
    const activities = staff ? await listSiteVisitActivities(id) : [];
    return NextResponse.json({visit, activities, history});
  });
}
