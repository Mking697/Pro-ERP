import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { AccountsError, getInvoice, updateInvoice } from "@/lib/accounts/accounts";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const { invoiceId } = await params;
  const detail = await getInvoice(invoiceId);
  if (!detail) {
    return NextResponse.json({ error: "Invoice nahi mili." }, { status: 404 });
  }
  return NextResponse.json(detail);
}

const bodySchema = z.object({
  invoiceNo: z.string().trim().optional(),
  invoiceAttachmentUrl: z.string().trim().optional(),
  ewayBillNo: z.string().trim().optional(),
  ewayBillAttachmentUrl: z.string().trim().optional(),
  extraDocumentUrl: z.string().trim().optional(),
  finalValue: z.coerce.number().nonnegative().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const { invoiceId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const invoice = await updateInvoice(invoiceId, parsed.data);
    return NextResponse.json({ invoice });
  } catch (err) {
    const message = err instanceof AccountsError || err instanceof Error ? err.message : "Update nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
