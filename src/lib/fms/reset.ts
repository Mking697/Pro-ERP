import { eq } from "drizzle-orm";
import { fmsTemplates, fmsRuns } from "@/db/schema";
import { db } from "@/db/client";
import { getTenantOrgId } from "@/lib/tenant";

export interface ResetFmsResult {
  templatesDeleted: number;
  runsDeleted: number;
}

/**
 * Wipes every FMS template (every version, Active or Archived — unlike deleteFmsTemplate,
 * which only ever removes one Archived version at a time) and every run/instance, pending
 * steps and finished history alike. For clearing out flows and test data built while
 * designing, before an organization starts running FMS for real.
 *
 * Irreversible: a real row delete, not an archive — there is nothing to undo this with
 * once it runs. The API route calling this is Admin-only for exactly that reason.
 */
export async function resetAllFmsData(): Promise<ResetFmsResult> {
  const orgId = await getTenantOrgId();

  const [deletedTemplates, deletedRuns] = await Promise.all([
    db.delete(fmsTemplates).where(eq(fmsTemplates.orgId, orgId)).returning({ templateId: fmsTemplates.templateId }),
    db.delete(fmsRuns).where(eq(fmsRuns.orgId, orgId)).returning({ id: fmsRuns.id }),
  ]);

  return { templatesDeleted: deletedTemplates.length, runsDeleted: deletedRuns.length };
}
