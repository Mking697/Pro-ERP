import { costingMutationKey, costingRoute } from "@/lib/costing/http";
import { costingService } from "@/lib/costing/service";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return costingRoute(async () => { const key = costingMutationKey(request); return Response.json({ sheet: await costingService.finalize((await context.params).id, await request.json(), key) }); });
}
