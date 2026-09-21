import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAnyModule, requireModule } from "@/lib/auth/guard";
import { listInwardEntries, createInwardEntry } from "@/lib/inward";

// Reading inward entries is not a public-to-the-org fact: party names, invoice numbers
// and attachment URLs are commercial information. Any one of the three inward grants is
// enough, which is the same test the nav and the inward report already apply.
export async function GET() {
  const guard = await requireAnyModule(["INWARD_ENTRY", "IQC_CHECK", "IMS_VIEW"]);
  if (!guard.ok) return guard.response;

  const entries = await listInwardEntries();
  return NextResponse.json({ entries });
}

const createInwardSchema = z.object({
  partyName: z.string().min(1, "Party Name zaroori hai."),
  vendorId: z.string().trim().optional().default(""),
  invoiceNo: z.string().min(1, "Invoice No. zaroori hai."),
  inwardType: z.enum(["Raw Material", "Consumable", "Other"]),
  attachmentUrl: z.string().optional().default(""),
  remark: z.string().optional().default(""),
  // Optional: naming an item is what lets a passed quality check reach stock.
  sku: z.string().trim().optional().default(""),
  itemName: z.string().trim().optional().default(""),
});

export async function POST(request: Request) {
  const guard = await requireModule("INWARD_ENTRY");
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
    const entry = await createInwardEntry({
      ...parsed.data,
      createdBy: guard.session.userId,
    });
    return NextResponse.json({ entry });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Entry create nahi ho payi.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
