import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { byNewest } from "@/lib/timestamp";
import {
  createFmsTemplate,
  listFmsTemplates,
  type FmsTemplateStepRecord,
} from "@/lib/fms/templates";
import { templateBodySchema } from "./schema";

interface TemplateSummary {
  templateId: string;
  templateName: string;
  triggerEvent: string;
  status: string;
  createdAt: string;
  createdBy: string;
  steps: FmsTemplateStepRecord[];
}

/** Groups the flat FMS_TEMPLATES rows into one entry per Template_ID — same shape the
 * board needs, computed here rather than re-grouped in the client on every render. */
function groupTemplates(rows: FmsTemplateStepRecord[]): TemplateSummary[] {
  const byId = new Map<string, TemplateSummary>();
  for (const row of rows) {
    let summary = byId.get(row.Template_ID);
    if (!summary) {
      summary = {
        templateId: row.Template_ID,
        templateName: row.Template_Name,
        triggerEvent: row.Trigger_Event,
        status: row.Status,
        createdAt: row.Created_At,
        createdBy: row.Created_By,
        steps: [],
      };
      byId.set(row.Template_ID, summary);
    }
    summary.steps.push(row);
  }
  for (const summary of byId.values()) {
    summary.steps.sort((a, b) => Number(a.Step_No) - Number(b.Step_No));
  }
  return [...byId.values()].sort((a, b) => byNewest(a.createdAt, b.createdAt));
}

export async function GET() {
  const guard = await requireModule("FMS_ADMIN");
  if (!guard.ok) return guard.response;

  const rows = await listFmsTemplates();
  return NextResponse.json({ templates: groupTemplates(rows) });
}

export async function POST(request: Request) {
  const guard = await requireModule("FMS_ADMIN");
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = templateBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const templateId = await createFmsTemplate({
      templateName: parsed.data.templateName,
      triggerEvent: parsed.data.triggerEvent,
      createdBy: guard.session.userId,
      steps: parsed.data.steps,
    });
    return NextResponse.json({ templateId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Template save nahi hui.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
