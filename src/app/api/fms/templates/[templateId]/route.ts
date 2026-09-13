import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { updateFmsTemplate } from "@/lib/fms/templates";
import { templateBodySchema } from "../schema";

/**
 * Edits a template — writes a new version and archives the old one (see
 * updateFmsTemplate's own reasoning). Never mutates the existing rows in place, so an
 * instance already running against the old version is never disturbed mid-flow.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ templateId: string }> }
) {
  const guard = await requireModule("FMS_ADMIN");
  if (!guard.ok) return guard.response;

  const { templateId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = templateBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const newTemplateId = await updateFmsTemplate(templateId, {
      templateName: parsed.data.templateName,
      triggerEvent: parsed.data.triggerEvent,
      createdBy: guard.session.userId,
      steps: parsed.data.steps,
    });
    return NextResponse.json({ templateId: newTemplateId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Template update nahi ho payi.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
