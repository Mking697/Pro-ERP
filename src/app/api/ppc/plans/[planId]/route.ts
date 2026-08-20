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
        return NextResponse.json({ plan });
      }
      case "complete":
        return NextResponse.json({ plan: await completePlan(planId) });
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
