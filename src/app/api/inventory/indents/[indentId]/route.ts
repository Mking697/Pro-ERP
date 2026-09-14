import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { approveIndent, cancelIndent } from "@/lib/inventory/indents";
import { emitFmsEvent } from "@/lib/fms/engine";

const patchSchema = z.object({
  action: z.enum(["approve", "cancel"]),
  finalQty: z.coerce.number().positive().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ indentId: string }> }
) {
  const guard = await requireModule("INDENT_APPROVE");
  if (!guard.ok) return guard.response;

  const { indentId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input." }, { status: 400 });
  }

  try {
    const indent =
      parsed.data.action === "approve"
        ? await approveIndent(indentId, guard.session.userId, parsed.data.finalQty)
        : await cancelIndent(indentId);

    // Best-effort: lets an org-defined "Purchase FMS" (PO details -> follow-up ->
    // received) pick up the moment an indent is approved — not this route depending on
    // the FMS engine's own module graph. approveIndent() itself never imports it, to
    // avoid indents.ts depending on fms/engine.ts the way plans.ts and inward.ts don't.
    if (parsed.data.action === "approve") {
      try {
        await emitFmsEvent("INDENT_APPROVED", `INDENTS:${indentId}`);
      } catch (error) {
        console.error(`[indents] FMS event emit failed for ${indentId}:`, error);
      }
    }

    return NextResponse.json({ indent });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
