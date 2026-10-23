import { costingRoute } from "@/lib/costing/http";
import { getProductCostSheet } from "@/lib/costing/service";
import { CostingError } from "@/lib/costing/validation";
import { exportCostSheet } from "@/lib/costing/export";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return costingRoute(async () => {
    const sheet = await getProductCostSheet((await context.params).id);
    if (!sheet) throw new CostingError("Cost sheet not found", 404);
    const bytes = await exportCostSheet(sheet);
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="cost-sheet-${sheet.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)}-r${sheet.revision}.xlsx"`,
      "X-Content-Type-Options": "nosniff",
    } });
  });
}
