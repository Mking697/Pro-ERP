import { NextResponse } from "next/server";
import { fieldRoute, forbidden } from "@/lib/fieldService/api";
import { getComplaint, listComplaintActivities } from "@/lib/fieldService/complaints";
import { isTaskAssignedToDoer } from "@/lib/fieldService/assignments";
import { getTaskHistory } from "@/lib/fieldService/steps";
export async function GET(_request: Request, {params}: {params: Promise<{id:string}>}) {
  return fieldRoute(["COMPLAINT_FMS"], false, async (session, orgId, staff) => {
    const {id} = await params;
    if (!staff && !(await isTaskAssignedToDoer(orgId, "COMPLAINT", id, session.userId))) return forbidden();
    const complaint = await getComplaint(id);
    if (!complaint) return NextResponse.json({error:"Task nahi mila."}, {status:404});
    const history = await getTaskHistory(orgId, "COMPLAINT", id, staff ? undefined : session.userId);
    // Activity text can include later rounds: doers use only their authorized round history.
    const activities = staff ? await listComplaintActivities(id) : [];
    return NextResponse.json({complaint, activities, history});
  });
}
