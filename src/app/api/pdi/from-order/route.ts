import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { PdiError, punchOrderIntoPdi } from "@/lib/pdi/pdi";

const bodySchema = z.object({
  orderId: z.string().trim().min(1),
});

/** Punches one Ready_For_PDI order into a new PDI inspection row — mirrors
 * /api/orders/from-quotation's own "complete step 1 in one action" shape. */
export async function POST(request: Request) {
  const guard = await requireModule("PDI_FMS");
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
    const inspection = await punchOrderIntoPdi(parsed.data.orderId, guard.session.userId);
    return NextResponse.json({ inspection });
  } catch (err) {
    const message = err instanceof PdiError || err instanceof Error ? err.message : "PDI nahi ban payi.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
