import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { tryModule } from "@/lib/moduleSheets";
import { createVendor, listVendors } from "@/lib/parties/vendors";

export async function GET() {
  const guard = await requireModule("PARTY_MASTER");
  if (!guard.ok) return guard.response;

  const vendors = await tryModule(() => listVendors());
  return NextResponse.json({
    vendors: vendors ?? [],
    setupRequired: vendors === null ? "Vendor Master" : null,
  });
}

const createSchema = z.object({
  vendorName: z.string().trim().min(1, "Vendor ka naam zaroori hai."),
  contactPerson: z.string().trim().optional().default(""),
  phone: z.string().trim().optional().default(""),
  email: z.string().trim().optional().default(""),
  gstin: z.string().trim().optional().default(""),
  address: z.string().trim().optional().default(""),
  city: z.string().trim().optional().default(""),
  state: z.string().trim().optional().default(""),
  paymentTerms: z.string().trim().optional().default(""),
  bankName: z.string().trim().optional().default(""),
  bankAccountNo: z.string().trim().optional().default(""),
  ifsc: z.string().trim().optional().default(""),
});

export async function POST(request: Request) {
  const guard = await requireModule("PARTY_MASTER");
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const { vendor, warning } = await createVendor({ ...parsed.data, createdBy: guard.session.email });
    return NextResponse.json({ vendor, warning });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Vendor ban nahi paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
