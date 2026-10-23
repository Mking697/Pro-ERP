import { jobCostMutationKey, jobCostRoute } from "@/lib/job-costing/http";
import { jobCostFinalizeService } from "@/lib/job-costing/service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return jobCostRoute(async () => {
    const key = jobCostMutationKey(request);
    const sheet = await jobCostFinalizeService.finalize((await context.params).id, await request.json(), key);
    return Response.json({ sheet });
  });
}
