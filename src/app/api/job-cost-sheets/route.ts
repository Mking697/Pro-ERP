import { jobCostMutationKey, jobCostRoute } from "@/lib/job-costing/http";
import { jobCostDraftService, jobCostSheetSummary, listJobCostSheetsByPlan } from "@/lib/job-costing/service";
import { JobCostStoreError } from "@/lib/job-costing/store";

export async function GET(request: Request) {
  return jobCostRoute(async () => {
    const planId = new URL(request.url).searchParams.get("planId");
    if (!planId) throw new JobCostStoreError("planId query parameter is required");
    const sheets = await listJobCostSheetsByPlan(planId);
    return Response.json({ sheets: sheets.map(jobCostSheetSummary).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.revision - a.revision), nextCursor: null });
  });
}

export async function POST(request: Request) {
  return jobCostRoute(async () => {
    const key = jobCostMutationKey(request);
    return Response.json({ sheet: await jobCostDraftService.createDraft(await request.json(), key) });
  });
}
