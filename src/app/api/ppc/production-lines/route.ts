import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { tryModule } from "@/lib/moduleSheets";
import { listFmsTemplates, type FmsTemplateStepRecord } from "@/lib/fms/templates";

/**
 * The "Production Line" picker on the plan form needs only Active templates meant to run
 * on PRODUCTION_STARTED, by name — not the full step configuration FMS_ADMIN's own
 * /api/fms/templates returns. A planner (PPC_PLAN) usually doesn't hold FMS_ADMIN, so this
 * is a separate, narrower endpoint rather than widening that one's guard.
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

  const rows = await tryModule(() => listFmsTemplates());
  const lines = firstSteps(rows ?? [])
    .filter((s) => s.Status === "Active" && s.Trigger_Event === "PRODUCTION_STARTED")
    .map((s) => ({ templateId: s.Template_ID, templateName: s.Template_Name }));

  return NextResponse.json({ lines });
}
