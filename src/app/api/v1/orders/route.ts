import { withApiKeyTenant } from "@/lib/auth/apiKeyGuard";
import { listOrders, type OrderStatus } from "@/lib/orders/orders";
import { paginate } from "@/lib/apiAccess/pagination";

const VALID_STATUSES: OrderStatus[] = [
  "Items_Pending",
  "Payment_Review",
  "Credit_Hold",
  "Stock_Check",
  "Dispatch_Pending",
  "Ready_For_PDI",
  "Cancelled",
];

/** GET /api/v1/orders — this org's own orders, read-only. `?status=` optional (one of
 * the real OrderStatus values), `?limit=&cursor=` for pagination. */
export async function GET(request: Request) {
  return withApiKeyTenant(request, async () => {
    const url = new URL(request.url);
    const statusParam = url.searchParams.get("status");
    const status =
      statusParam && (VALID_STATUSES as string[]).includes(statusParam)
        ? (statusParam as OrderStatus)
        : undefined;

    const orders = await listOrders(status);
    return paginate(orders, url);
  });
}
