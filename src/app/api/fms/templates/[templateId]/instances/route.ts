import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { getFmsTemplateSteps, userCanAccessTemplate } from "@/lib/fms/templates";
import { listFmsRunsForTemplate } from "@/lib/fms/engine";
import { resolveInstanceReferences } from "@/lib/fms/reference";

/**
 * Everything one FMS template's Flow Board needs: its own ordered step list, every
 * FMS_RUNS row against it (any instance, any status), and a resolved human-readable
 * Reference per instance (see src/lib/fms/reference.ts).
 *
 * Gated the same way the page itself is (src/app/fms/[templateId]/page.tsx) — an
 * FMS_ADMIN sees any template, anyone else only one whose static step design assigns
 * them (userCanAccessTemplate) — checked again here rather than trusted from the client,
 * since an API route can't rely on the page's own redirect having been honoured.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const { templateId } = await params;

  const steps = await getFmsTemplateSteps(templateId);
  if (steps.length === 0) {
    return NextResponse.json({ error: "Template nahi mila." }, { status: 404 });
  }

  const isAdmin = guard.session.access.includes("FMS_ADMIN");
  if (!userCanAccessTemplate(steps, guard.session.userId, isAdmin)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const orderedSteps = steps.map((s) => ({
    stepNo: Number(s.Step_No),
    stepName: s.Step_Name,
    assignedTo: s.Assigned_To,
    dataSourceConfig: s.Data_Source_Config,
  }));

  const templateRuns = await listFmsRunsForTemplate(templateId);

  const firstRefByInstance = new Map<string, string>();
  for (const run of templateRuns) {
    if (!firstRefByInstance.has(run.Instance_ID)) {
      firstRefByInstance.set(run.Instance_ID, run.Context_Ref);
    }
  }

  const references = await resolveInstanceReferences(
    [...firstRefByInstance.entries()].map(([instanceId, contextRef]) => ({
      instanceId,
      contextRef,
    }))
  );

  return NextResponse.json({
    templateName: steps[0].Template_Name,
    steps: orderedSteps,
    runs: templateRuns,
    references: Object.fromEntries(references),
  });
}
