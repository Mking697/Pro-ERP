import { getModuleRows, getModuleDefinition, tryModule } from "@/lib/moduleSheets";
import { THIS_FLOW_SOURCE, parseFormData, type ExistingFmsDataSourceConfig } from "@/lib/fms/dataSource";

/** `"<MODULE_KEY>:<id>"` -> the id half — the same convention every emitFmsEvent caller
 * already writes into Context_Ref (see src/lib/inward.ts, src/lib/fms/engine.ts). */
function contextId(contextRef: string): string {
  const sep = contextRef.indexOf(":");
  return sep === -1 ? "" : contextRef.slice(sep + 1);
}

/**
 * Live-pulls the columns an "Existing FMS" data source asks for — either from another
 * connected module's sheet, or from an earlier step of this same running instance.
 *
 * Always reads fresh (no cache): a step's context (e.g. "how much did IPQC just pass")
 * must never be stale, since an Action may write a stock movement off it a moment later.
 */
export async function resolveExistingFmsData(
  config: ExistingFmsDataSourceConfig,
  contextRef: string,
  instanceId: string
): Promise<Record<string, string>[]> {
  if (config.sourceModule === THIS_FLOW_SOURCE) {
    if (!config.sourceStepNo) return [];
    const runs = await tryModule(() => getModuleRows<Record<string, string>>("FMS_RUNS"));
    if (!runs) return [];
    return runs
      .filter((r) => r.Instance_ID === instanceId && Number(r.Step_No) === config.sourceStepNo)
      .map((r) => ({ ...r, ...parseFormData(r.Form_Data) }));
  }

  const rows = await tryModule(() => getModuleRows<Record<string, string>>(config.sourceModule));
  if (!rows) return [];

  let filtered = rows;
  if (config.filterByContext) {
    const id = contextId(contextRef);
    if (!id) return [];
    let idColumn: string;
    try {
      idColumn = getModuleDefinition(config.sourceModule).headers[0];
    } catch {
      return [];
    }
    filtered = rows.filter((r) => r[idColumn] === id);
  }

  return filtered.map((row) => {
    const projected: Record<string, string> = {};
    for (const col of config.columns) projected[col] = row[col] ?? "";
    return projected;
  });
}
