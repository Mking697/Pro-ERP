import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { confirmDispatch, DispatchError } from "@/lib/dispatch/dispatch";

const bodySchema = z.object({
  assignedTo: z.string().trim().min(1, "Assignee chunna zaroori hai."),
  tatValue: z.coerce.number().positive("TAT value 0 se zyada honi chahiye."),
  tatUnit: z.enum(["Minutes", "Hours", "Days"]),
  gatePassAttachmentUrl: z.string().trim().optional(),
});

/** Step 1 — Confirm Dispatch: issues the Gate Pass, writes the real stock_ledger "Out", and
 * assigns someone with a TAT (see confirmDispatch()'s own header comment). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  const guard = await requireModule("DISPATCH_FMS");
  if (!guard.ok) return guard.response;

  const { shipmentId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const dispatch = await confirmDispatch(shipmentId, parsed.data, guard.session.userId);
    return NextResponse.json({ dispatch });
  } catch (err) {
    const message = err instanceof DispatchError || err instanceof Error ? err.message : "Dispatch confirm nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
