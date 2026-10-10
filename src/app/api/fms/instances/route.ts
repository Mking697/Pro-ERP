import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { startFmsInstance } from "@/lib/fms/engine";
import { getMutationKey, MutationConflictError } from "@/lib/mutations";

/** Manual start, for a MANUAL-trigger template — every other trigger fires this same
 * engine function itself, from emitFmsEvent(). */
const bodySchema = z.object({
  templateId: z.string().trim().min(1),
  contextRef: z.string().trim().optional().default(""),
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
    const run = await startFmsInstance({
      templateId: parsed.data.templateId,
      contextRef: parsed.data.contextRef,
      startedBy: guard.session.userId,
    }, getMutationKey(request));
    return NextResponse.json({ run });
  } catch (err) {
    if (err instanceof Error && "committed" in err && err.committed === true && "result" in err) {
      return NextResponse.json({ run: err.result, committed: true, warning: err.message });
    }
    if (err instanceof MutationConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Instance start nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
