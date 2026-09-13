import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { tryModule } from "@/lib/moduleSheets";
import { byNewest } from "@/lib/timestamp";
import {
  createFmsTemplate,
  listFmsTemplates,
  type FmsTemplateStepRecord,
} from "@/lib/fms/templates";

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

  const rows = await tryModule(() => listFmsTemplates());
  return NextResponse.json({
    templates: rows === null ? [] : groupTemplates(rows),
    setupRequired: rows === null ? "FMS Templates" : null,
  });
}

const stepSchema = z
  .object({
    stepNo: z.coerce.number().int().positive(),
    stepName: z.string().trim().min(1, "Har step ka naam zaroori hai."),
    assignedTo: z.string().trim().min(1, "Har step kisi user ko assign hona chahiye."),
    tatValue: z.coerce.number().positive("TAT 0 se zyada hona chahiye."),
    tatUnit: z.enum(["Hours", "Days"]),
    outcomeOptions: z.array(z.string().trim().min(1)).min(1, "Kam se kam ek outcome chahiye."),
    nextStepMap: z.record(z.string(), z.union([z.literal("END"), z.coerce.number().int().positive()])),
  })
  .refine((step) => step.outcomeOptions.every((o) => o in step.nextStepMap), {
    message: "Har outcome ke liye agla step (ya END) chunein.",
  });

const bodySchema = z.object({
  templateName: z.string().trim().min(1, "Template ka naam zaroori hai."),
  triggerEvent: z.string().trim().min(1).default("MANUAL"),
  steps: z.array(stepSchema).min(1, "Kam se kam ek step chahiye."),
});

export async function POST(request: Request) {
  const guard = await requireModule("FMS_ADMIN");
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
