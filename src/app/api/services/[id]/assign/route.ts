import { NextResponse } from "next/server";
import { fieldRoute, jsonObject } from "@/lib/fieldService/api";
import { validateAssignment, validateCycle } from "@/lib/fieldService/validation";
import { assignDoers } from "@/lib/fieldService/assignments";
export async function POST(request: Request, {params}: {params: Promise<{id:string}>}) {
  return fieldRoute(["SERVICE_FMS"], true, async (session, orgId) => {
    const {id} = await params;
    const input = validateAssignment(await jsonObject(request), orgId);
    await assignDoers(orgId, "SERVICE", id, input.doerIds, input.fundAmount ?? null, input.fundNotes ?? "", session.userId, validateCycle(input.cycle));
    return NextResponse.json({ok:true});
  });
}
