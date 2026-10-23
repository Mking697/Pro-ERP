import { jobCostMutationKey, jobCostRoute } from "@/lib/job-costing/http";
import { getJobCostSheet, jobCostDraftService } from "@/lib/job-costing/service";
import { JobCostStoreError } from "@/lib/job-costing/store";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  return jobCostRoute(async () => {
    const sheet = await getJobCostSheet((await context.params).id);
    if (!sheet) throw new JobCostStoreError("Job cost sheet not found", 404);
    return Response.json({ sheet });
  });
}

export async function PATCH(request: Request, context: Context) {
  return jobCostRoute(async () => {
    const key = jobCostMutationKey(request);
    const sheet = await jobCostDraftService.updateDraft((await context.params).id, await request.json(), key);
    return Response.json({ sheet });
  });
}
