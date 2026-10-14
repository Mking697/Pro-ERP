import { NextResponse } from "next/server";
import { fieldRoute, forbidden } from "@/lib/fieldService/api";
import { getServiceJob, listServiceJobActivities } from "@/lib/fieldService/serviceJobs";
import { isTaskAssignedToDoer } from "@/lib/fieldService/assignments";
import { getTaskHistory } from "@/lib/fieldService/steps";
export async function GET(_request: Request, {params}: {params: Promise<{id:string}>}) {
  return fieldRoute(["SERVICE_FMS"], false, async (session, orgId, staff) => {
    const {id} = await params;
    if (!staff && !(await isTaskAssignedToDoer(orgId, "SERVICE", id, session.userId))) return forbidden();
    const job = await getServiceJob(id);
    if (!job) return NextResponse.json({error:"Task nahi mila."}, {status:404});
    const history = await getTaskHistory(orgId, "SERVICE", id, staff ? undefined : session.userId);
    // Activity text can include later rounds: doers use only their authorized round history.
    const activities = staff ? await listServiceJobActivities(id) : [];
    return NextResponse.json({job, activities, history});
  });
}
