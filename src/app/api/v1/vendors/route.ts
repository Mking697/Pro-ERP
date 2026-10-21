import { withApiKeyTenant } from "@/lib/auth/apiKeyGuard";
import { listVendors } from "@/lib/parties/vendors";
import { paginate } from "@/lib/apiAccess/pagination";

/** GET /api/v1/vendors — this org's own vendor master, read-only.
 * `?limit=&cursor=` for pagination. */
export async function GET(request: Request) {
  return withApiKeyTenant(request, async () => {
    const url = new URL(request.url);
    const vendors = await listVendors();
    return paginate(vendors, url);
  });
}
