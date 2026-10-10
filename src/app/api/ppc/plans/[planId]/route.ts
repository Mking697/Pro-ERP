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
import { getMutationKey, MutationConflictError } from "@/lib/mutations";

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
          guard.session.email,
          getMutationKey(request)
        );

        return NextResponse.json({ plan });
      }
      case "complete": {
        const plan = await completePlan(planId, guard.session.email, getMutationKey(request));
        return NextResponse.json({ plan });
      }
      case "cancel": {
        const plan = await cancelPlan(planId, guard.session.email, getMutationKey(request));
        return NextResponse.json({ plan });
      }
      case "recheck": {
        const plan = await reallocatePlan(planId, guard.session.email, getMutationKey(request));
        return NextResponse.json({ plan });
      }
    }
  } catch (err) {
    if (err instanceof Error && "committed" in err && err.committed === true && "result" in err) {
      return NextResponse.json({ plan: err.result, committed: true, warning: err.message });
    }
    if (err instanceof MutationConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof PlanError || err instanceof InsufficientStockError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Update nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
