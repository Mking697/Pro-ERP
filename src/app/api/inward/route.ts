import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/guard";
import { listInwardEntries, createInwardEntry } from "@/lib/inward";

export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const entries = await listInwardEntries();
  return NextResponse.json({ entries });
}

const createInwardSchema = z.object({
  partyName: z.string().min(1, "Party Name zaroori hai."),
  invoiceNo: z.string().min(1, "Invoice No. zaroori hai."),
  inwardType: z.enum(["Raw Material", "Consumable", "Other"]),
  attachmentUrl: z.string().optional().default(""),
  remark: z.string().optional().default(""),
});

export async function POST(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = createInwardSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const entry = await createInwardEntry(parsed.data);
    return NextResponse.json({ entry });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Entry create nahi ho payi.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
