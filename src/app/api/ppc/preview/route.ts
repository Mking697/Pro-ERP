import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { previewPlans, PlanError } from "@/lib/inventory/plans";

const bodySchema = z.object({
  lines: z
    .array(
      z.object({
        productName: z.string().trim().min(1),
        plannedQty: z.coerce.number().positive(),
        productionDate: z.string().trim().min(1),
      })
    )
    .min(1),
});

/**
 * Runs the allocation without writing, so the planner sees every product's shortage
 * before committing to it — and sees it computed the same way submitting will.
 */
export async function POST(request: Request) {
  const guard = await requireModule("PPC_PLAN");
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ lines: [] });
  }

  try {
    const lines = await previewPlans(parsed.data.lines);
    return NextResponse.json({ lines });
  } catch (err) {
    if (err instanceof PlanError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Check nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
