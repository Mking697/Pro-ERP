import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { setFmsTemplateStatus } from "@/lib/fms/templates";

const bodySchema = z.object({ status: z.enum(["Active", "Archived"]) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const guard = await requireModule("FMS_ADMIN");
  if (!guard.ok) return guard.response;

  const { templateId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    await setFmsTemplateStatus(templateId, parsed.data.status);
    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Status badal nahi paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
