import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { inspect, PdiError } from "@/lib/pdi/pdi";

const bodySchema = z.object({
  result: z.enum(["Pass", "Fail"]),
  remark: z.string().trim().optional(),
  attachmentUrl: z.string().trim().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ pdiId: string }> }
) {
  const guard = await requireModule("PDI_FMS");
  if (!guard.ok) return guard.response;

  const { pdiId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const inspection = await inspect(pdiId, parsed.data, guard.session.userId);
    return NextResponse.json({ inspection });
  } catch (err) {
    const message = err instanceof PdiError || err instanceof Error ? err.message : "Inspect nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
