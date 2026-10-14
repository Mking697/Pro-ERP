import { NextResponse } from "next/server";
import { fieldRoute, MODULE_FOR_TYPE, forbidden, jsonObject } from "@/lib/fieldService/api";
import { getFieldTaskCore, type FieldTaskType } from "@/lib/fieldService/core";
import { isTaskAssignedToDoerInCycle } from "@/lib/fieldService/assignments";
import { getStep, getTaskHistory, submitStep1, submitStep2, submitStep3 } from "@/lib/fieldService/steps";
import { FieldValidationError, parseCycle, validateCycle, validateStep } from "@/lib/fieldService/validation";
const keys = Object.values(MODULE_FOR_TYPE);
function taskType(value: unknown): FieldTaskType {
  if (value !== "SERVICE" && value !== "COMPLAINT" && value !== "SITE_VISIT") throw new FieldValidationError("Invalid task type.");
  return value;
}
export async function GET(req: Request) {
  return fieldRoute(keys, false, async (session, orgId) => {
    const query = new URL(req.url).searchParams;
    const type = taskType(query.get("taskType"));
    const id = query.get("taskId");
    if (!id) throw new FieldValidationError("Task id required.");
    const task = await getFieldTaskCore(orgId, type, id);
    if (!task) return NextResponse.json({error:"Task nahi mila."}, {status:404});
    const cycle = query.has("cycle") ? parseCycle(query.get("cycle")!) : task.currentCycle;
    if (cycle > task.currentCycle) throw new FieldValidationError("Invalid cycle.");
    const staff = session.access.includes(MODULE_FOR_TYPE[type]);
    if (!staff && !(await isTaskAssignedToDoerInCycle(orgId, type, id, session.userId, cycle))) return forbidden();
    const step = await getStep(orgId, type, id, cycle);
    const history = await getTaskHistory(orgId, type, id, staff ? undefined : session.userId);
    return NextResponse.json({step, cycle, history});
  });
}
export async function POST(req: Request) {
  return fieldRoute(keys, false, async (session, orgId) => {
    const body = await jsonObject(req);
    const type = taskType(body.taskType);
    if (typeof body.taskId !== "string" || !body.taskId.trim()) throw new FieldValidationError("Task id required.");
    const cycle = validateCycle(body.cycle);
    let result;
    if (body.step === 1) result = await submitStep1(orgId, type, body.taskId, session.userId, validateStep(type, 1, body, orgId), cycle);
    else if (body.step === 2) result = await submitStep2(orgId, type, body.taskId, session.userId, validateStep(type, 2, body, orgId), cycle);
    else if (body.step === 3) result = await submitStep3(orgId, type, body.taskId, session.userId, validateStep(type, 3, body, orgId), cycle);
    else throw new FieldValidationError("Invalid step.");
    return NextResponse.json({step:result});
  });
}
