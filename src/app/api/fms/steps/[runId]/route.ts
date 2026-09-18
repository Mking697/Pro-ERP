import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { getFmsStepContext } from "@/lib/fms/engine";

/**
 * What the Complete-step dialog needs before the user submits: the step's Data Source
 * shape, and — for an Existing-FMS source — the actual pulled reference row(s).
 *
 * `referenceRows` can carry data a step's own module grant would normally gate (e.g. a
 * Vendor's bank details pulled via an "Existing FMS" source) — reading is the sensitive
 * operation here, not just writing, so this needs the same ownership check
 * `completeFmsStep` enforces before completion: only the run's own assignee, or an
 * FMS_ADMIN, may see it.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const { runId } = await params;
  const context = await getFmsStepContext(runId);
  if (!context) {
    return NextResponse.json({ error: "Step nahi mila." }, { status: 404 });
  }

  const isOwner = context.run.Assigned_To === guard.session.userId;
  const isAdmin = guard.session.access.includes("FMS_ADMIN");
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Ye step aapko assign nahi hai." }, { status: 403 });
  }

  return NextResponse.json({
    outcomeOptions: context.step.Outcome_Options.split(",").map((s) => s.trim()).filter(Boolean),
    outcomeType: context.step.Outcome_Type || "",
    quantity: context.run.Quantity || "",
    formConfig: context.dataSource.form ?? null,
    referenceRows: context.referenceRows,
  });
}
