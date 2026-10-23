import { jobCostRoute } from "@/lib/job-costing/http";
import { getJobCostSheet } from "@/lib/job-costing/service";
import { JobCostStoreError } from "@/lib/job-costing/store";
import { exportJobCostSheetCsv, exportJobCostSheetXlsx } from "@/lib/job-costing/export";
import { csvResponseHeaders } from "@/lib/csv";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return jobCostRoute(async () => {
    const sheet = await getJobCostSheet((await context.params).id);
    if (!sheet) throw new JobCostStoreError("Job cost sheet not found", 404);
    const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "xlsx";
    if (format === "csv") {
      const { csv, filename } = exportJobCostSheetCsv(sheet);
      return new Response(csv, { headers: csvResponseHeaders(filename) });
    }
    const { buffer, filename } = await exportJobCostSheetXlsx(sheet);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
