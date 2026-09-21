import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import type { ModuleAccessKey } from "@/lib/moduleAccess";
import {
  cancelPlan,
  completePlan,
  reallocatePlan,
  startProduction,
  PlanError,
} from "@/lib/inventory/plans";
import { InsufficientStockError } from "@/lib/inventory/ledger";
import { startFmsInstance } from "@/lib/fms/engine";

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    actualQty: z.coerce.number().positive("Actual quantity 0 se zyada honi chahiye."),
  }),
  z.object({ action: z.literal("complete") }),
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("recheck") }),
]);

/**
 * Starting and completing production belong to the people on the floor, planning and
 * cancelling to whoever plans — so the two are guarded by different grants rather than
 * one blanket PPC permission.
 */
const GUARD: Record<string, ModuleAccessKey> = {
  start: "INVENTORY_TXN",
  complete: "INVENTORY_TXN",
  cancel: "PPC_PLAN",
  recheck: "PPC_PLAN",
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ planId: string }> }
) {
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid action." },
      { status: 400 }
    );
  }

  const guard = await requireModule(GUARD[parsed.data.action]);
  if (!guard.ok) return guard.response;

  const { planId } = await params;

  try {
    switch (parsed.data.action) {
      case "start": {
        const plan = await startProduction(
          planId,
          parsed.data.actualQty,
          guard.session.email
        );

        // Best-effort: lets an org-defined FMS "Line" (e.g. Winding -> ... -> IPQC -> PDI
        // -> Dispatch) pick up right when the physical manufacturing actually begins —
        // not this route depending on the FMS engine's own module graph. startProduction()
        // itself never imports it, to avoid a circular import back through the Action
        // engine's own use of plans.ts.
        //
        // Only a plan with its own chosen Line (fmsTemplateId) starts one — directly, by
        // that exact template id. A blank fmsTemplateId starts no Line at all; it used to
        // broadcast-fire every Active PRODUCTION_STARTED template instead, which meant two
        // products each needing a different Line would both fire for every plan that hadn't
        // picked one — exactly the ambiguity picking a Line exists to remove. Explicit
        // "no Line for this plan" is safer than an implicit guess.
        if (plan.fmsTemplateId) {
          try {
            await startFmsInstance({
              templateId: plan.fmsTemplateId,
              contextRef: `PRODUCTION_PLANS:${planId}`,
              startedBy: "SYSTEM",
              initialQuantity: plan.actualQty ?? undefined,
            });
          } catch (error) {
            console.error(`[ppc] FMS Line start failed for ${planId}:`, error);
          }
        }

        return NextResponse.json({ plan });
      }
      case "complete": {
        const plan = await completePlan(planId, guard.session.email);
        return NextResponse.json({ plan });
      }
      case "cancel":
        return NextResponse.json({ plan: await cancelPlan(planId) });
      case "recheck":
        return NextResponse.json({ plan: await reallocatePlan(planId) });
    }
  } catch (err) {
    if (err instanceof PlanError || err instanceof InsufficientStockError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Update nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
