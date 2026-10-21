import { withApiKeyTenant } from "@/lib/auth/apiKeyGuard";
import { listCustomers } from "@/lib/parties/customers";
import { paginate } from "@/lib/apiAccess/pagination";

/** GET /api/v1/customers — this org's own customer master, read-only.
 * `?limit=&cursor=` for pagination. */
export async function GET(request: Request) {
  return withApiKeyTenant(request, async () => {
    const url = new URL(request.url);
    const customers = await listCustomers();
    return paginate(customers, url);
  });
}
