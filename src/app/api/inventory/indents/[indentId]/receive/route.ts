import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { receiveIndent, IndentReceiptError } from "@/lib/inventory/indents";

const bodySchema = z.object({
  quantity: z.coerce.number().positive("Quantity 0 se zyada honi chahiye."),
  location: z.string().trim().optional().default(""),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ indentId: string }> }
) {
  // Receiving writes to the ledger, which is what INVENTORY_TXN governs.
  const guard = await requireModule("INVENTORY_TXN");
  if (!guard.ok) return guard.response;

  const { indentId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const indent = await receiveIndent(
      indentId,
      parsed.data.quantity,
      guard.session.userId,
      parsed.data.location
    );
    return NextResponse.json({ indent });
  } catch (err) {
    if (err instanceof IndentReceiptError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Receive nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
