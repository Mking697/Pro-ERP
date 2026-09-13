import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/guard";
import { completeFmsStep } from "@/lib/fms/engine";

const bodySchema = z.object({
  outcome: z.string().trim().min(1, "Outcome chunein."),
  remark: z.string().optional().default(""),
});

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const { runId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const result = await completeFmsStep({
      runId,
      outcome: parsed.data.outcome,
      completedBy: guard.session.userId,
      remark: parsed.data.remark,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Step complete nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
