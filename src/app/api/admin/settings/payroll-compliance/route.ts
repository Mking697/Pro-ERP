import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { getAllSettings, upsertSetting } from "@/lib/settings";

export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const settings = await getAllSettings();
  return NextResponse.json({
    pfEnabled: settings.PF_ENABLED === "true",
    esiEnabled: settings.ESI_ENABLED === "true",
    tdsEnabled: settings.TDS_ENABLED === "true",
  });
}

const bodySchema = z.object({
  pfEnabled: z.boolean(),
  esiEnabled: z.boolean(),
  tdsEnabled: z.boolean(),
});

export async function POST(request: Request) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }

  await Promise.all([
    upsertSetting("PF_ENABLED", String(parsed.data.pfEnabled)),
    upsertSetting("ESI_ENABLED", String(parsed.data.esiEnabled)),
    upsertSetting("TDS_ENABLED", String(parsed.data.tdsEnabled)),
  ]);

  return NextResponse.json({ success: true });
}
