import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { approveIndent, cancelIndent } from "@/lib/inventory/indents";

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
    return NextResponse.json({ indent });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
