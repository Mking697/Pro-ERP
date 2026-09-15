import { getModuleRows, deleteModuleRows } from "@/lib/moduleSheets";

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
 * Irreversible: a direct sheet-row delete, not an archive — there is nothing to undo this
 * with once it runs. The API route calling this is Admin-only for exactly that reason.
 */
export async function resetAllFmsData(): Promise<ResetFmsResult> {
  const [templateRows, runRows] = await Promise.all([
    getModuleRows("FMS_TEMPLATES"),
    getModuleRows("FMS_RUNS"),
  ]);

  if (templateRows.length > 0) {
    await deleteModuleRows(
      "FMS_TEMPLATES",
      templateRows.map((_, i) => i + 2)
    );
  }
  if (runRows.length > 0) {
    await deleteModuleRows(
      "FMS_RUNS",
      runRows.map((_, i) => i + 2)
    );
  }

  return { templatesDeleted: templateRows.length, runsDeleted: runRows.length };
}
