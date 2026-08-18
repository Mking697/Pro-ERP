import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { listRecurringTasks, createRecurringTask } from "@/lib/recurringTasks";
import { DELEGATOR_ROLES } from "@/lib/roles";
import { FREQUENCY_CODES } from "@/lib/frequency";

export async function GET() {
  const guard = await requireRole(DELEGATOR_ROLES);
  if (!guard.ok) return guard.response;

  const rules = await listRecurringTasks();
  return NextResponse.json({ rules });
}

const createSchema = z.object({
  task: z.string().min(1, "Task zaroori hai."),
  doerId: z.string().min(1, "Doer select karein."),
  frequency: z.enum(FREQUENCY_CODES),
  assignDate: z.string().min(1, "Assign Date zaroori hai."),
});

export async function POST(request: Request) {
  const guard = await requireRole(DELEGATOR_ROLES);
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const rule = await createRecurringTask({ ...parsed.data, assignedBy: guard.session.userId });
    return NextResponse.json({ rule });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Recurring task create nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
