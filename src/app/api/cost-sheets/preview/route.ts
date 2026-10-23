import { costingRoute } from "@/lib/costing/http";
import { previewCostSheet } from "@/lib/costing/service";
export async function POST(request: Request) { return costingRoute(async () => Response.json({ calculation: await previewCostSheet(await request.json()) })); }
