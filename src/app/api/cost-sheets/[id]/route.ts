import { costingMutationKey, costingRoute } from "@/lib/costing/http";
import { costingService, getProductCostSheet } from "@/lib/costing/service";
import { CostingError } from "@/lib/costing/validation";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  return costingRoute(async () => { const sheet = await getProductCostSheet((await context.params).id); if (!sheet) throw new CostingError("Cost sheet not found", 404); return Response.json({ sheet }); });
}
export async function PATCH(request: Request, context: Context) {
  return costingRoute(async () => { const key = costingMutationKey(request); return Response.json({ sheet: await costingService.update((await context.params).id, await request.json(), key) }); });
}
