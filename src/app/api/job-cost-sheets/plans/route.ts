import { jobCostRoute } from "@/lib/job-costing/http";
import { listEligibleJobCostPlans } from "@/lib/job-costing/service";

export async function GET(request: Request) {
  return jobCostRoute(async () => {
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const limitParam = url.searchParams.get("limit");
    const limit = limitParam ? Number(limitParam) : undefined;
    return Response.json(await listEligibleJobCostPlans({ cursor, limit }));
  });
}
