import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { listFmsTemplates, type FmsTemplateStepRecord } from "@/lib/fms/templates";

/**
 * The "Production Line" picker on the plan form needs only Active templates, by name —
 * not the full step configuration FMS_ADMIN's own /api/fms/templates returns. A planner
 * (PPC_PLAN) usually doesn't hold FMS_ADMIN, so this is a separate, narrower endpoint
 * rather than widening that one's guard.
 *
 * Every Active template is offered, regardless of its own Trigger_Event — picking one
 * here starts it with a direct startFmsInstance() call (see the "start" action in
 * api/ppc/plans/[planId]/route.ts), which never consults Trigger_Event at all. Filtering
 * to only Trigger_Event === "PRODUCTION_STARTED" templates was tried first and was wrong:
 * a template's default trigger is "MANUAL", so a Line built without deliberately retyping
 * that field would silently never appear in this list.
 */
function firstSteps(rows: FmsTemplateStepRecord[]): FmsTemplateStepRecord[] {
  const byId = new Map<string, FmsTemplateStepRecord>();
  for (const row of rows) {
    if (Number(row.Step_No) !== 1) continue;
    byId.set(row.Template_ID, row);
  }
  return [...byId.values()];
}

export async function GET() {
  const guard = await requireModule("PPC_PLAN");
  if (!guard.ok) return guard.response;

  const rows = await listFmsTemplates();
  const lines = firstSteps(rows)
    .filter((s) => s.Status === "Active")
    .map((s) => ({ templateId: s.Template_ID, templateName: s.Template_Name }));

  return NextResponse.json({ lines });
}
