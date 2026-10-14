import { NextResponse } from "next/server";
import { fieldRoute, jsonObject } from "@/lib/fieldService/api";
import { FieldValidationError, validateCycle } from "@/lib/fieldService/validation";
import { unassignDoer } from "@/lib/fieldService/assignments";
export async function POST(request: Request, {params}: {params: Promise<{id:string}>}) {
  return fieldRoute(["SERVICE_FMS"], true, async (session, orgId) => {
    const {id} = await params;
    const body = await jsonObject(request);
    if (typeof body.doerId !== "string" || !body.doerId.trim()) throw new FieldValidationError("Doer id required.");
    await unassignDoer(orgId, "SERVICE", id, body.doerId, session.userId, validateCycle(body.cycle));
    return NextResponse.json({ok:true});
  });
}
