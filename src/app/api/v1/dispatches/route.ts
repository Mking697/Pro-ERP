import { withApiKeyTenant } from "@/lib/auth/apiKeyGuard";
import { listDispatches, type DispatchStatus } from "@/lib/dispatch/dispatch";
import { paginate } from "@/lib/apiAccess/pagination";

const VALID_STATUSES: DispatchStatus[] = ["In_Transit", "Dispatched", "Delivered"];

/** GET /api/v1/dispatches — this org's own dispatch/shipment records, read-only.
 * `?status=` optional (In_Transit|Dispatched|Delivered), `?limit=&cursor=` for pagination. */
export async function GET(request: Request) {
  return withApiKeyTenant(request, async () => {
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const status =
      statusParam && (VALID_STATUSES as string[]).includes(statusParam)
        ? (statusParam as DispatchStatus)
        : undefined;

    const dispatches = await listDispatches(status);
    return paginate(dispatches, url);
  });
}
