import { getSourceModuleDefinition } from "@/lib/fms/sourceModules";
import { THIS_FLOW_SOURCE, parseFormData, type ExistingFmsDataSourceConfig } from "@/lib/fms/dataSource";
import { listFmsTemplates } from "@/lib/fms/templates";
import { listWeekoffOverrides } from "@/lib/fms/weekoffOverrides";
import { listTasks } from "@/lib/tasks";
import { listRecurringTasks } from "@/lib/recurringTasks";
import { getHolidayDates } from "@/lib/holidays";
import { listInwardEntries, listFailureLog, listImsInward } from "@/lib/inward";
import { listItems } from "@/lib/inventory/items";
import { listLedger } from "@/lib/inventory/ledger";
import { listIndents } from "@/lib/inventory/indents";
import { listBomRows } from "@/lib/inventory/bom";
import { listPlans, type Plan, type PlanMaterial } from "@/lib/inventory/plans";
import { listVendors } from "@/lib/parties/vendors";
import { listCustomers } from "@/lib/parties/customers";

/** `"<MODULE_KEY>:<id>"` -> the id half — the same convention every emitFmsEvent caller
 * already writes into Context_Ref (see src/lib/inward.ts, src/lib/fms/engine.ts). */
function contextId(contextRef: string): string {
  const sep = contextRef.indexOf(":");
  return sep === -1 ? "" : contextRef.slice(sep + 1);
}

/** A production plan, projected back onto PRODUCTION_PLANS' old flat-sheet header names —
 * Plan (src/lib/inventory/plans.ts) is camelCase internally, unlike every other migrated
 * module's own *Record type, so this is the one real shape adapter this file needs. */
function planToRow(p: Plan): Record<string, string> {
  return {
    Plan_ID: p.planId,
    Timestamp: p.timestamp,
    Product_Name: p.productName,
    Product_SKU: p.productSku,
    BOM_ID: p.bomId,
    BOM_Version: String(p.bomVersion),
    Planned_Qty: String(p.plannedQty),
    Production_Date: p.productionDate,
    Status: p.status,
    Actual_Qty: p.actualQty !== null ? String(p.actualQty) : "",
    Started_By: p.startedBy,
    Started_At: p.startedAt,
    Created_By: p.createdBy,
    Notes: p.notes,
    Job_No: p.jobNo,
    Order_No: p.orderNo,
    FMS_Template_ID: p.fmsTemplateId,
  };
}

function planMaterialToRow(p: Plan, m: PlanMaterial): Record<string, string> {
  return {
    Plan_ID: p.planId,
    SKU: m.sku,
    Item_Name: m.itemName,
    Qty_Per_Unit: String(m.qtyPerUnit),
    Required_Qty: String(m.requiredQty),
    UOM: m.uom,
    Allocated_Qty: String(m.allocatedQty),
    Shortage_Qty: String(m.shortageQty),
    Consumed_Qty: String(m.consumedQty),
    Status: m.status,
    Created_At: "",
  };
}

/**
 * Every module an "Existing FMS" pull (or a "lookup" form field — see
 * src/app/api/fms/lookup-source/route.ts, which shares this) can name as its source,
 * mapped to the already-migrated (Phase 3) list function that now actually backs it.
 *
 * This is the piece that keeps the generic "any source module key" design (see
 * src/lib/fms/sourceModules.ts) FMS was built with alive after the Sheets cutover: every
 * module below moved to Postgres in an earlier Phase 3 group, but each kept its own
 * PascalCase `*Record` shape matching the old sheet headers exactly (per that group's own
 * migration) — VENDORS, CUSTOMERS, ITEMS,
 * STOCK_LEDGER, INDENTS, BOM, INWARD_IQC_FMS/FAILURE_LOG/IMS_INWARD, TASKS,
 * RECURRING_TASKS all read straight through. PRODUCTION_PLANS/PLAN_MATERIALS is the one
 * real exception (Plan is camelCase internally), so it goes through the two adapters
 * above. HOLIDAY_LIST never had more than a bare Date column, so it's synthesized the
 * same shape from getHolidayDates()'s Set.
 *
 * FMS_RUNS is fetched via a *dynamic* import of fms/engine.ts rather than a static one —
 * engine.ts imports resolveExistingFmsData (below) at module scope already, so a static
 * import back here would be a real circular module graph; deferring it to call time avoids
 * that while still reading the exact same live Postgres-backed rows.
 */
async function listSourceModuleRows(sourceModule: string): Promise<Record<string, string>[]> {
  switch (sourceModule) {
    case "TASKS":
      return listTasks() as unknown as Promise<Record<string, string>[]>;
    case "RECURRING_TASKS":
      return listRecurringTasks() as unknown as Promise<Record<string, string>[]>;
    case "HOLIDAY_LIST":
      return [...(await getHolidayDates())].map((date) => ({ Date: date }));
    case "INWARD_IQC_FMS":
      return listInwardEntries() as unknown as Promise<Record<string, string>[]>;
    case "FAILURE_LOG":
      return listFailureLog() as unknown as Promise<Record<string, string>[]>;
    case "IMS_INWARD":
      return listImsInward() as unknown as Promise<Record<string, string>[]>;
    case "ITEMS":
      return listItems() as unknown as Promise<Record<string, string>[]>;
    case "STOCK_LEDGER":
      return listLedger() as unknown as Promise<Record<string, string>[]>;
    case "INDENTS":
      return listIndents() as unknown as Promise<Record<string, string>[]>;
    case "BOM":
      return listBomRows() as unknown as Promise<Record<string, string>[]>;
    case "PRODUCTION_PLANS": {
      const plans = await listPlans();
      return plans.map(planToRow);
    }
    case "PLAN_MATERIALS": {
      const plans = await listPlans();
      return plans.flatMap((p) => p.materials.map((m) => planMaterialToRow(p, m)));
    }
    case "VENDORS":
      return listVendors() as unknown as Promise<Record<string, string>[]>;
    case "CUSTOMERS":
      return listCustomers() as unknown as Promise<Record<string, string>[]>;
    case "FMS_TEMPLATES":
      return listFmsTemplates() as unknown as Promise<Record<string, string>[]>;
    case "FMS_WEEKOFF_OVERRIDES":
      return listWeekoffOverrides() as unknown as Promise<Record<string, string>[]>;
    case "FMS_RUNS": {
      const { listAllFmsRuns } = await import("@/lib/fms/engine");
      return (await listAllFmsRuns()) as unknown as Record<string, string>[];
    }
    default:
      return [];
  }
}

/**
 * Live-pulls the columns an "Existing FMS" data source asks for — either from another
 * connected module (now a Postgres-backed list function via listSourceModuleRows above),
 * or from an earlier step of this same running instance.
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
    const { listAllFmsRuns } = await import("@/lib/fms/engine");
    const runs = (await listAllFmsRuns()) as unknown as Record<string, string>[];
    return runs
      .filter((r) => r.Instance_ID === instanceId && Number(r.Step_No) === config.sourceStepNo)
      .map((r) => ({ ...r, ...parseFormData(r.Form_Data) }));
  }

  const rows = await listSourceModuleRows(config.sourceModule);

  let filtered = rows;
  if (config.filterByContext) {
    const id = contextId(contextRef);
    if (!id) return [];
    const idColumn = getSourceModuleDefinition(config.sourceModule)?.headers[0];
    if (!idColumn) return [];
    filtered = rows.filter((r) => r[idColumn] === id);
  }

  return filtered.map((row) => {
    const projected: Record<string, string> = {};
    for (const col of config.columns) projected[col] = row[col] ?? "";
    return projected;
  });
}

/** Shared with src/app/api/fms/lookup-source/route.ts, which backs the "lookup" form
 * field type (the doer picks a row from another connected module, e.g. Customers) — same
 * underlying data, no Context_Ref filtering since a lookup always browses the whole
 * module. */
export { listSourceModuleRows };
