import { eq } from "drizzle-orm";
import { fmsTemplates, fmsRuns } from "@/db/schema";
import { db, runInTenantTransaction } from "@/db/client";
import { getTenantOrgId } from "@/lib/tenant";

export interface ResetFmsResult {
  templatesDeleted: number;
  runsDeleted: number;
}

/**
 * Design-time reset only. Production-linked runs are durable FG-writer election
 * evidence, including completed history: deleting them would let completePlan
 * produce the same FG again. Reject the entire reset rather than silently erase
 * that evidence. Admission and both deletes share the production tenant lock.
 */
export async function resetAllFmsData(): Promise<ResetFmsResult> {
  const orgId = await getTenantOrgId();
  return runInTenantTransaction(orgId, async () => {
    const runs = await db.select({ contextRef: fmsRuns.contextRef }).from(fmsRuns)
      .where(eq(fmsRuns.orgId, orgId));
    if (runs.some((run) => run.contextRef.startsWith("PRODUCTION_PLANS:"))) {
      throw new Error("FMS reset blocked: production-linked history must be preserved.");
    }
    const deletedRuns = await db.delete(fmsRuns).where(eq(fmsRuns.orgId, orgId)).returning({ id: fmsRuns.id });
    const deletedTemplates = await db.delete(fmsTemplates).where(eq(fmsTemplates.orgId, orgId)).returning({ templateId: fmsTemplates.templateId });
    return { templatesDeleted: deletedTemplates.length, runsDeleted: deletedRuns.length };
  });
}
