import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { createTransportVendor, listTransportVendors } from "@/lib/tms/transportVendors";

export async function GET() {
  const guard = await requireModule("TMS_FMS");
  if (!guard.ok) return guard.response;

  const vendors = await listTransportVendors();
  return NextResponse.json({ vendors });
}

const createSchema = z.object({
  vendorName: z.string().trim().min(1, "Transport Vendor ka naam zaroori hai."),
  contactPerson: z.string().trim().optional().default(""),
  phone: z.string().trim().optional().default(""),
  email: z.string().trim().optional().default(""),
  gstin: z.string().trim().optional().default(""),
  address: z.string().trim().optional().default(""),
  city: z.string().trim().optional().default(""),
  state: z.string().trim().optional().default(""),
});

export async function POST(request: Request) {
  const guard = await requireModule("TMS_FMS");
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
    const { vendor, warning } = await createTransportVendor({ ...parsed.data, createdBy: guard.session.email });
    return NextResponse.json({ vendor, warning });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transport Vendor ban nahi paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
