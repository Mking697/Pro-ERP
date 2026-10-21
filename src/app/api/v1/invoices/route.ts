import { withApiKeyTenant } from "@/lib/auth/apiKeyGuard";
import { listInvoices, type InvoiceStatus } from "@/lib/accounts/accounts";
import { paginate } from "@/lib/apiAccess/pagination";

const VALID_STATUSES: InvoiceStatus[] = ["Draft", "Issued"];

/** GET /api/v1/invoices — this org's own invoices, read-only. `?status=` optional
 * (Draft|Issued), `?limit=&cursor=` for pagination. */
export async function GET(request: Request) {
  return withApiKeyTenant(request, async () => {
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const status =
      statusParam && (VALID_STATUSES as string[]).includes(statusParam)
        ? (statusParam as InvoiceStatus)
        : undefined;

    const invoices = await listInvoices(status);
    return paginate(invoices, url);
  });
}
