import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { tryModule } from "@/lib/moduleSheets";
import { createPlans, listPlans, PlanError } from "@/lib/inventory/plans";

export async function GET() {
  const guard = await requireModule("PPC_PLAN");
  if (!guard.ok) return guard.response;

  const plans = await tryModule(() => listPlans());
  return NextResponse.json({
    plans: plans ?? [],
    setupRequired: plans === null ? "Production Plans (PPC)" : null,
  });
}

const lineSchema = z.object({
  productName: z.string().trim().min(1, "Product chunein."),
  plannedQty: z.coerce.number().positive("Quantity 0 se zyada honi chahiye."),
  productionDate: z.string().trim().min(1, "Production date daalein."),
  notes: z.string().trim().optional().default(""),
});

const bodySchema = z.object({
  lines: z.array(lineSchema).min(1, "Kam se kam ek product chahiye."),
});

export async function POST(request: Request) {
  const guard = await requireModule("PPC_PLAN");
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const plans = await createPlans(parsed.data.lines, guard.session.email);
    return NextResponse.json({ plans });
  } catch (err) {
    if (err instanceof PlanError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Plan save nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
