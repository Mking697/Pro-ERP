import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { findById } from "@/db/repo";
import { vendors } from "@/db/schema";
import { getTenantOrgId } from "@/lib/tenant";
import { listVendorItems, upsertVendorItem, VendorItemAdmissionError } from "@/lib/parties/vendorItems";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ vendorId: string }> }
) {
  const guard = await requireModule("PARTY_MASTER");
  if (!guard.ok) return guard.response;

  const { vendorId } = await params;
  const items = await listVendorItems(vendorId);
  return NextResponse.json({ items });
}

const optionalNumber = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => {
    if (v === undefined || v === null || String(v).trim() === "") return null;
    const n = Number(v);
    return n;
  })
  .pipe(z.number().nullable());

const upsertSchema = z.object({
  sku: z.string().trim().min(1, "Item chunna zaroori hai."),
  leadTimeDays: optionalNumber.pipe(z.number().int().min(0).max(2147483647).nullable()),
  unitPrice: optionalNumber.pipe(z.number().min(0).nullable()),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ vendorId: string }> }
) {
  const guard = await requireModule("PARTY_MASTER");
  if (!guard.ok) return guard.response;

  const { vendorId } = await params;
  const orgId = await getTenantOrgId();
  const vendor = await findById(vendors, orgId, vendorId);
  if (!vendor) {
    return NextResponse.json({ error: "Vendor nahi mila." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const item = await upsertVendorItem({
      vendorId,
      sku: parsed.data.sku,
      leadTimeDays: parsed.data.leadTimeDays,
      unitPrice: parsed.data.unitPrice,
      createdBy: guard.session.email,
    });
    return NextResponse.json({ item });
  } catch (error) {
    if (error instanceof Error && "committed" in error && error.committed === true && "result" in error) {
      return NextResponse.json({ item: error.result, committed: true, warning: error.message });
    }
    if (error instanceof VendorItemAdmissionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
