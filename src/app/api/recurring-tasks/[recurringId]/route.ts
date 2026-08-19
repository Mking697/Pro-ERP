import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { setRecurringTaskStatus, RECURRING_STATUSES } from "@/lib/recurringTasks";

const patchSchema = z.object({ status: z.enum(RECURRING_STATUSES) });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ recurringId: string }> }
) {
  const guard = await requireModule("RECURRING_ASSIGN");
  if (!guard.ok) return guard.response;

  const { recurringId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  try {
    const rule = await setRecurringTaskStatus(recurringId, parsed.data.status);
    return NextResponse.json({ rule });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
