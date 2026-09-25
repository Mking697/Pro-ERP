import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { getSetting, upsertSetting } from "@/lib/settings";

const DEFAULT_VALUE = 24;
const DEFAULT_UNIT = "Hours";

export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const [tatValue, tatUnit, deviationApprover] = await Promise.all([
    getSetting("INWARD_IQC_TAT_VALUE"),
    getSetting("INWARD_IQC_TAT_UNIT"),
    getSetting("INWARD_IQC_DEVIATION_APPROVER"),
  ]);

  return NextResponse.json({
    tatValue: Number(tatValue) > 0 ? Number(tatValue) : DEFAULT_VALUE,
    tatUnit: tatUnit === "Days" ? "Days" : DEFAULT_UNIT,
    deviationApprover: deviationApprover ?? "",
  });
}

const bodySchema = z.object({
  tatValue: z.coerce.number().positive("TAT 0 se zyada hona chahiye."),
  tatUnit: z.enum(["Hours", "Days"]),
  // Optional: the setup screen may be saved before an approver is chosen.
  deviationApprover: z.string().optional(),
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

  await Promise.all([
    upsertSetting("INWARD_IQC_TAT_VALUE", String(parsed.data.tatValue)),
    upsertSetting("INWARD_IQC_TAT_UNIT", parsed.data.tatUnit),
    upsertSetting("INWARD_IQC_DEVIATION_APPROVER", parsed.data.deviationApprover ?? ""),
  ]);

  return NextResponse.json({ success: true });
}
