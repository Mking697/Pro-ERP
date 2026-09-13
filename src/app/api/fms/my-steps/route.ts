import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { listMyPendingFmsSteps } from "@/lib/fms/engine";
import { listFmsTemplates } from "@/lib/fms/templates";
import { tryModule } from "@/lib/moduleSheets";

/** Anyone signed in can see the steps assigned to them — same tier as Tasks, no grant
 * needed just to be someone's assignee. */
export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const steps = await tryModule(() => listMyPendingFmsSteps(guard.session.userId));
  if (steps === null) {
    return NextResponse.json({ steps: [], setupRequired: "FMS Runs" });
  }

  // A step's valid outcomes live on its template definition, not on the run row itself —
  // joined here once so the Complete dialog doesn't need a second round trip per step.
  const templateSteps = await tryModule(() => listFmsTemplates());
  const optionsByKey = new Map(
    (templateSteps ?? []).map((s) => [`${s.Template_ID}:${s.Step_No}`, s.Outcome_Options])
  );

  const enriched = steps.map((run) => ({
    ...run,
    Outcome_Options: optionsByKey.get(`${run.Template_ID}:${run.Step_No}`) ?? "",
  }));

  return NextResponse.json({ steps: enriched, setupRequired: null });
}
