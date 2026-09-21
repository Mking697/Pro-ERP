import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { listLeaveApprovalSteps, saveLeaveApprovalSteps } from "@/lib/leave/approvalSetup";

export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const steps = await listLeaveApprovalSteps();
  return NextResponse.json({ steps });
}

const bodySchema = z.object({
  steps: z
    .array(
      z.object({
        approverType: z.enum(["REPORTING_MANAGER", "SPECIFIC_USER"]),
        specificUserId: z.string().trim().optional().default(""),
      })
    )
    .max(10, "10 se zyada steps nahi ban sakte."),
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
  if (parsed.data.steps.some((s) => s.approverType === "SPECIFIC_USER" && !s.specificUserId)) {
    return NextResponse.json(
      { error: "Har 'Specific User' step ke liye ek user chunein." },
      { status: 400 }
    );
  }

  await saveLeaveApprovalSteps(parsed.data.steps);
  const steps = await listLeaveApprovalSteps();
  return NextResponse.json({ steps });
}
