import { costingRoute } from "@/lib/costing/http";
import { getCostCatalog } from "@/lib/costing/service";
export async function GET() { return costingRoute(async () => Response.json({ products: await getCostCatalog() })); }
