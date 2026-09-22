import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { getOrderSetup, saveOrderSetup } from "@/lib/orders/settings";

export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const setup = await getOrderSetup();
  return NextResponse.json({ setup });
}

const tatUnitSchema = z.enum(["Minutes", "Hours", "Days"]);

const bodySchema = z.object({
  step1TatValue: z.coerce.number().positive("Step 1 ka TAT 0 se zyada hona chahiye."),
  step1TatUnit: tatUnitSchema,
  step1Doer: z.string().trim().optional().default(""),
  step2TatValue: z.coerce.number().positive("Step 2 ka TAT 0 se zyada hona chahiye."),
  step2TatUnit: tatUnitSchema,
  step2Doer: z.string().trim().optional().default(""),
  step3TatValue: z.coerce.number().positive("Step 3 ka TAT 0 se zyada hona chahiye."),
  step3TatUnit: tatUnitSchema,
  step3Doer: z.string().trim().optional().default(""),
  step4TatValue: z.coerce.number().positive("Step 4 ka TAT 0 se zyada hona chahiye."),
  step4TatUnit: tatUnitSchema,
  step4Doer: z.string().trim().optional().default(""),
  creditHoldApprover: z.string().trim().optional().default(""),
});

export async function POST(request: Request) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  await saveOrderSetup(parsed.data);
  return NextResponse.json({ success: true });
}
