import { listAllFmsRuns } from "@/lib/fms/engine";
import { listPlans } from "@/lib/inventory/plans";
import { byNewest } from "@/lib/timestamp";

const PRODUCTION_PLANS_PREFIX = "PRODUCTION_PLANS:";

export interface FmsHistoryRow {
  runId: string;
  instanceId: string;
  templateName: string;
  stepName: string;
  assignedTo: string;
  quantity: string;
  outcome: string;
  status: string;
  completedAt: string;
  tatDeadline: string;
  remark: string;
  /** Resolved from Context_Ref when it points at a production plan — blank otherwise
   * (a flow started from Inward or an indent approval has no Job/Order No to show). */
  jobNo: string;
  orderNo: string;
  productName: string;
}

/**
 * Every FMS step that has left "Pending" — a doer-wise, job-wise record of what happened
 * and when, joined back to the production plan's Job No/Order No (when the flow was
 * started from one) via Context_Ref, the same "MODULE_KEY:id" convention every
 * emitFmsEvent caller already writes.
 *
 * Reads live, no caching — same reasoning as the rest of FMS: a history table people are
 * actively working from (rather than glancing at) should never lag what just happened.
 */
export async function listFmsHistory(): Promise<FmsHistoryRow[]> {
  const [runs, plans] = await Promise.all([listAllFmsRuns(), listPlans().catch(() => [])]);

  const planById = new Map(plans.map((p) => [p.planId, p]));

  return runs
    .filter((r) => r.Status !== "Pending")
    .map((r) => {
      let jobNo = "";
      let orderNo = "";
      let productName = "";

      if (r.Context_Ref.startsWith(PRODUCTION_PLANS_PREFIX)) {
        const plan = planById.get(r.Context_Ref.slice(PRODUCTION_PLANS_PREFIX.length));
        if (plan) {
          jobNo = plan.jobNo;
          orderNo = plan.orderNo;
          productName = plan.productName;
        }
      }

      return {
        runId: r.Run_ID,
        instanceId: r.Instance_ID,
        templateName: r.Template_Name,
        stepName: r.Step_Name,
        assignedTo: r.Assigned_To,
        quantity: r.Quantity,
        outcome: r.Outcome,
        status: r.Status,
        completedAt: r.Completed_At,
        tatDeadline: r.TAT_Deadline,
        remark: r.Remark,
        jobNo,
        orderNo,
        productName,
      };
    })
    .sort((a, b) => byNewest(a.completedAt, b.completedAt));
}
