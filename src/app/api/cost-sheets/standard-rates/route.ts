import { costingMutationKey, costingRoute } from "@/lib/costing/http";
import { costingService } from "@/lib/costing/service";
export async function POST(request: Request) {
  return costingRoute(async () => { const key = costingMutationKey(request); return Response.json({ rate: await costingService.approveStandard(await request.json(), key) }); });
}
