import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule, requireSession } from "@/lib/auth/guard";
import { listTasks, createTask } from "@/lib/tasks";
import { tryModule } from "@/lib/moduleSheets";
import { PRIORITIES } from "@/lib/priority";

export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const canDelegate = guard.session.access.includes("TASK_DELEGATE");
  const canAssignRecurring = guard.session.access.includes("RECURRING_ASSIGN");

  // An org that has not connected its Tasks sheet yet is mid-onboarding, not broken —
  // report that as a state the UI can render, rather than a 500.
  const allTasks = await tryModule(() => listTasks());
  if (allTasks === null) {
    return NextResponse.json({
      myTasks: [],
      delegatedTasks: [],
      canDelegate,
      canAssignRecurring,
      setupRequired: "Tasks",
    });
  }

  const myTasks = allTasks.filter((t) => t.Assigned_To === guard.session.userId);
  const delegatedTasks = canDelegate
    ? allTasks.filter((t) => t.Assigned_By === guard.session.userId)
    : [];

  return NextResponse.json({ myTasks, delegatedTasks, canDelegate, canAssignRecurring });
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
  const guard = await requireModule("TASK_DELEGATE");
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
