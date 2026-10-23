import { jobCostRoute } from "@/lib/job-costing/http";
import { previewJobCost } from "@/lib/job-costing/service";

/** Calculates without persisting; approval metadata in the response is preview-only. */
export async function POST(request: Request) {
  return jobCostRoute(async () => Response.json({ calculation: await previewJobCost(await request.json()) }));
}
