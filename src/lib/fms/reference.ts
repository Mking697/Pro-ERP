import { listPlans, type Plan } from "@/lib/inventory/plans";
import { listInwardEntries, type InwardRecord } from "@/lib/inward";

/** Context_Ref is always `"<MODULE_KEY>:<id>"` — the same convention every emitFmsEvent
 * caller writes (see src/lib/inward.ts, src/lib/fms/engine.ts) and the one
 * src/lib/fms/dataSourceResolver.ts's own contextId() already splits on. These are the
 * MODULE_SHEETS keys those callers actually use, not a display label. */
const PRODUCTION_PLANS_PREFIX = "PRODUCTION_PLANS:";
const INWARD_PREFIX = "INWARD_IQC_FMS:";

/**
 * Resolves every FMS instance's Context_Ref into a human-readable "Reference" string for
 * the Flow Board — a production plan's Job No, or an inward entry's Party Name. Falls back
 * to the raw Instance_ID when the prefix isn't recognised (a manually-started instance, or
 * a flow chained from a source this hasn't been taught to resolve).
 *
 * Reads both source modules up front, once, rather than per instance — mirrors
 * src/lib/fms/history.ts's own Production Plan join, extended here to also cover Inward.
 * Each source is skipped entirely when nothing in this batch needs it, and degrades to
 * an empty list on its own failure, so one disconnected sheet doesn't blank every
 * reference.
 */
export async function resolveInstanceReferences(
  instances: { instanceId: string; contextRef: string }[]
): Promise<Map<string, string>> {
  const needsPlans = instances.some((i) => i.contextRef.startsWith(PRODUCTION_PLANS_PREFIX));
  const needsInward = instances.some((i) => i.contextRef.startsWith(INWARD_PREFIX));

  const [plans, inwardEntries] = await Promise.all([
    needsPlans ? listPlans().catch(() => [] as Plan[]) : Promise.resolve([] as Plan[]),
    needsInward ? listInwardEntries().catch(() => [] as InwardRecord[]) : Promise.resolve([] as InwardRecord[]),
  ]);

  const planById = new Map(plans.map((p) => [p.planId, p]));
  const inwardById = new Map(inwardEntries.map((e) => [e.Entry_ID, e]));

  const out = new Map<string, string>();
  for (const { instanceId, contextRef } of instances) {
    let reference = instanceId;

    if (contextRef.startsWith(PRODUCTION_PLANS_PREFIX)) {
      const plan = planById.get(contextRef.slice(PRODUCTION_PLANS_PREFIX.length));
      if (plan) reference = plan.jobNo || plan.productName || instanceId;
    } else if (contextRef.startsWith(INWARD_PREFIX)) {
      const entry = inwardById.get(contextRef.slice(INWARD_PREFIX.length));
      if (entry) reference = entry.Party_Name || instanceId;
    }

    out.set(instanceId, reference);
  }

  return out;
}
