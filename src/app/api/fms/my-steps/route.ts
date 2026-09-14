import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { listMyPendingFmsSteps, listMyDashboardFmsSteps } from "@/lib/fms/engine";
import { listFmsTemplates } from "@/lib/fms/templates";
import { tryModule } from "@/lib/moduleSheets";

/**
 * Anyone signed in can see the steps assigned to them — same tier as Tasks, no grant
 * needed just to be someone's assignee.
 *
 * `?scope=dashboard` additionally keeps a step visible for the rest of the working day
 * it was completed on — the Dashboard's own list, so a step doesn't vanish from the
 * screen the instant it's marked Done. The default (no scope) stays the FMS page's own
 * plain Pending-only "My Steps" contract, unchanged.
 */
export async function GET(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const dashboard = new URL(request.url).searchParams.get("scope") === "dashboard";
  const steps = await tryModule(() =>
    dashboard
      ? listMyDashboardFmsSteps(guard.session.userId)
      : listMyPendingFmsSteps(guard.session.userId)
  );
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
