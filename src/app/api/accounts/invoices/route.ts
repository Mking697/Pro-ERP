import { getMutationKey, runIdempotentTenantMutation, MutationConflictError, MutationInputError } from "@/lib/mutations";
import { getTenantOrgId } from "@/lib/tenant";
import { LedgerConflictError } from "@/lib/accounts/ledger";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { AccountsError, createInvoice, listInvoices, type InvoiceStatus } from "@/lib/accounts/accounts";

const STATUSES: InvoiceStatus[] = ["Draft", "Issued"];

export async function GET(request: Request) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const status = STATUSES.includes(statusParam as InvoiceStatus) ? (statusParam as InvoiceStatus) : undefined;

  const invoices = await listInvoices(status);
  return NextResponse.json({ invoices });
}

const bodySchema = z.object({
  orderId: z.string().trim().min(1),
  invoiceNo: z.string().trim().optional(),
  invoiceAttachmentUrl: z.string().trim().optional(),
  ewayBillNo: z.string().trim().optional(),
  ewayBillAttachmentUrl: z.string().trim().optional(),
  extraDocumentUrl: z.string().trim().optional(),
  finalValue: z.coerce.number().nonnegative(),
});

export async function POST(request: Request) {
  const guard = await requireModule("ACCOUNTS_FMS");
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const invoice = await runIdempotentTenantMutation(await getTenantOrgId(), {
      operation: "accounts.invoices.v1", actorId: guard.session.userId, key: getMutationKey(request),
      // Parsed JSON input; omit absent optional fields, never hash a Date/domain row.
      payload: JSON.parse(JSON.stringify({ ...parsed.data })),
    }, async () => ({ ...await createInvoice(parsed.data, guard.session.userId) }));
    return NextResponse.json({ invoice });
  } catch (err) {
    if (err instanceof MutationConflictError || err instanceof MutationInputError || err instanceof LedgerConflictError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof AccountsError || err instanceof Error ? err.message : "Invoice ban nahi payi.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
