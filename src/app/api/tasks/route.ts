import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, requireSession } from "@/lib/auth/guard";
import { listTasks, createTask } from "@/lib/tasks";
import { DELEGATOR_ROLES } from "@/lib/roles";
import { PRIORITIES } from "@/lib/priority";

export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const allTasks = await listTasks();
  const canDelegate = DELEGATOR_ROLES.includes(guard.session.role as (typeof DELEGATOR_ROLES)[number]);

  const myTasks = allTasks.filter((t) => t.Assigned_To === guard.session.userId);
  const delegatedTasks = canDelegate
    ? allTasks.filter((t) => t.Assigned_By === guard.session.userId)
    : [];

  return NextResponse.json({ myTasks, delegatedTasks, canDelegate });
}

// One-time tasks only — recurring tasks are created via /api/recurring-tasks instead.
const createTaskSchema = z.object({
  title: z.string().min(1, "Title zaroori hai."),
  description: z.string().optional().default(""),
  assignedTo: z.string().min(1, "Assign to zaroori hai."),
  priority: z.enum(PRIORITIES),
  dueDate: z.string().min(1, "Completion date & time zaroori hai."),
  attachmentUrl: z.string().optional().default(""),
  remark: z.string().optional().default(""),
});

export async function POST(request: Request) {
  const guard = await requireRole(DELEGATOR_ROLES);
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const task = await createTask({ ...parsed.data, assignedBy: guard.session.userId });
    return NextResponse.json({ task });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Task create nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
