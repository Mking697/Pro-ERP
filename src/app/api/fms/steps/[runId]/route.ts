import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { getFmsStepContext } from "@/lib/fms/engine";

/**
 * What the Complete-step dialog needs before the user submits: the step's Data Source
 * shape, and — for an Existing-FMS source — the actual pulled reference row(s).
 *
 * Anyone signed in can call this for a run assigned to them (same tier as completing the
 * step itself) — ownership isn't re-checked here since nothing is written; the complete
 * endpoint is what enforces it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const { runId } = await params;
  const context = await getFmsStepContext(runId);
  if (!context) {
    return NextResponse.json({ error: "Step nahi mila." }, { status: 404 });
  }

  return NextResponse.json({
    outcomeOptions: context.step.Outcome_Options.split(",").map((s) => s.trim()).filter(Boolean),
    outcomeType: context.step.Outcome_Type || "",
    quantity: context.run.Quantity || "",
    formConfig: context.dataSource.form ?? null,
    referenceRows: context.referenceRows,
  });
}
