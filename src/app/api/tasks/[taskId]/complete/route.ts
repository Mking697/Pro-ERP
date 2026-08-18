import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/guard";
import { markTaskDone } from "@/lib/tasks";
import { getUserById } from "@/lib/auth/users";
import { sendWhatsAppMessage } from "@/lib/chatxflow";

const completeSchema = z.object({ proofUrl: z.string().optional().default("") });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const { taskId } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = completeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  try {
    const task = await markTaskDone(taskId, parsed.data.proofUrl, guard.session.userId);

    // Best-effort WhatsApp confirmation to whoever assigned this task — a failed
    // notification must never fail the completion itself.
    getUserById(task.Assigned_By)
      .then((assigner) => {
        if (!assigner?.Phone_Number) return;
        return sendWhatsAppMessage(
          assigner.Phone_Number,
          `${guard.session.fullName} ne "${task.Title}" task complete kar diya hai (${task.Status}).`
        );
      })
      .catch(() => {});

    return NextResponse.json({ task });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Task complete nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
