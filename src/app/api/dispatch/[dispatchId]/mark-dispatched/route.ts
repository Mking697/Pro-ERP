import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/guard";
import { markDispatched, DispatchError } from "@/lib/dispatch/dispatch";
import type { ModuleAccessKey } from "@/lib/moduleAccess";

const bodySchema = z.object({
  proofOfDispatchUrl: z.string().trim().optional(),
});

/**
 * Step 2 — Mark Dispatched: the assignee (who may not hold DISPATCH_FMS themselves — same
 * as any other picked assignee elsewhere in this codebase) or anyone holding DISPATCH_FMS.
 * Uses requireSession(), not requireModule(), because the assignee check happens inside
 * markDispatched() itself — narrowing to requireModule() here would lock out a legitimate
 * assignee with no module grant.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ dispatchId: string }> }
) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const { dispatchId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const dispatch = await markDispatched(dispatchId, parsed.data, {
      userId: guard.session.userId,
      access: guard.session.access as ModuleAccessKey[],
    });
    return NextResponse.json({ dispatch });
  } catch (err) {
    const message = err instanceof DispatchError || err instanceof Error ? err.message : "Mark Dispatched nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
