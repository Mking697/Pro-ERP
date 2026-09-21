import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guard";
import { getQuotationSetup, saveQuotationSetup } from "@/lib/leads/quotationSetup";

export async function GET() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const setup = await getQuotationSetup();
  return NextResponse.json({ setup });
}

const bodySchema = z.object({
  companyName: z.string().trim().optional().default(""),
  companyAddress: z.string().trim().optional().default(""),
  companyGstin: z.string().trim().optional().default(""),
  bankBeneficiary: z.string().trim().optional().default(""),
  bankName: z.string().trim().optional().default(""),
  bankAccountNo: z.string().trim().optional().default(""),
  bankIfsc: z.string().trim().optional().default(""),
  bankBranch: z.string().trim().optional().default(""),
  defaultSubject: z.string().trim().optional().default(""),
  defaultNote: z.string().trim().optional().default(""),
  defaultTerms: z.string().optional().default(""),
  gstPercent: z.coerce.number().min(0).max(100),
  numberPrefix: z.string().trim().min(1, "Number prefix zaroori hai."),
  numberStart: z.coerce.number().int().positive(),
  validityDays: z.coerce.number().int().positive(),
});

export async function POST(request: Request) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  await saveQuotationSetup(parsed.data);
  return NextResponse.json({ success: true });
}
