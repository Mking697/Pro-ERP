import { costingMutationKey, costingRoute } from "@/lib/costing/http";
import { costingService, listCostSheets } from "@/lib/costing/service";
export async function GET(request: Request) {
  return costingRoute(async () => Response.json({ sheets: await listCostSheets(new URL(request.url).searchParams.get("productSku") ?? undefined) }));
}
export async function POST(request: Request) {
  return costingRoute(async () => { const key = costingMutationKey(request); return Response.json({ sheet: await costingService.create(await request.json(), key) }); });
}
