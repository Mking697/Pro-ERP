/**
 * J5 — production HTTP wiring for Recorded Job Cost Sheets: binds the already-built J1-J4
 * core (engine/source/store/finalize) to live `requireModule("JOB_COST_SHEETS")` auth and
 * tenant resolution, plus the one genuinely new read this stage needs (eligible plan
 * listing — a plain query, not engine/valuation logic).
 *
 * No calculation/validation/persistence logic is reimplemented here: `calculateJobCost`,
 * `buildJobCostFacts`, `createJobCostDraftDomain` and `createJobCostFinalizeDomain` are the
 * single source of truth; this module only supplies the live actor/tenant and composes them.
 */
import { and, asc, eq, gt, inArray, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { fmsRuns, productionPlans } from "@/db/schema";
import { requireModule } from "@/lib/auth/guard";
import { getTenantOrgId } from "@/lib/tenant";
import { calculateJobCost } from "./engine";
import { createDbJobSourceStore } from "./source";
import { createDbJobCostDraftStore, createJobCostDraftDomain, JobCostStoreError, type JobCostActor } from "./store";
import { createDbJobCostFinalizeStore, createJobCostFinalizeDomain } from "./finalize";
import { jobCostInputSchema } from "./validation";
import type { JobCostCalculation, JobCostSheet } from "./types";

async function authorize(): Promise<JobCostActor> {
  const guard = await requireModule("JOB_COST_SHEETS");
  if (!guard.ok) throw new JobCostStoreError("Job cost sheet access denied", guard.response.status);
  const orgId = await getTenantOrgId();
  if (guard.tenant.orgId !== orgId) throw new JobCostStoreError("Tenant mismatch", 403);
  return { orgId: guard.tenant.orgId, actorId: guard.session.userId };
}

const jobSourceStore = createDbJobSourceStore();
const draftStore = createDbJobCostDraftStore(authorize, jobSourceStore);
/** Draft CRUD (create/get/list/update) — the real J3 domain, unmodified. */
export const jobCostDraftService = createJobCostDraftDomain(draftStore);

const finalizeStore = createDbJobCostFinalizeStore(authorize, (params) => draftStore.buildFacts(params));
/** Finalize — the real J4 domain, unmodified. */
export const jobCostFinalizeService = createJobCostFinalizeDomain(finalizeStore);

/** Preview: calculate without persisting. Same engine/adapter the Draft path uses. */
export async function previewJobCost(raw: unknown): Promise<JobCostCalculation> {
  const input = jobCostInputSchema.parse(raw);
  const actor = await authorize();
  const facts = await draftStore.buildFacts({ orgId: actor.orgId, planId: input.planId, asOfDate: input.asOfDate, capturedBy: actor.actorId });
  return calculateJobCost(input, facts);
}

export async function getJobCostSheet(id: string): Promise<JobCostSheet | null> {
  return jobCostDraftService.getDraft(id);
}

export async function listJobCostSheetsByPlan(planId: string): Promise<JobCostSheet[]> {
  return jobCostDraftService.listDraftsByPlan(planId);
}

export type JobCostPlanEligibility = "FinalizableNow" | "DraftOnly" | "FmsUnsupported";
export interface JobCostPlanOption {
  planId: string;
  jobNo: string;
  productSku: string;
  productName: string;
  status: string;
  eligibility: JobCostPlanEligibility;
  reason: string;
}

const FMS_UNSUPPORTED_REASON =
  "Plan has at least one FMS Production-Line run; visible with source diagnostics but not finalizable in this slice.";
const FINALIZABLE_REASON =
  "Completed, non-FMS plan. Preview/save a Draft, then finalize once materials/output/general sources are valued and classified.";
const DRAFT_ONLY_REASON =
  "Plan is not yet Completed. Preview/save an incomplete Draft only; finalize is blocked until the plan completes.";

/**
 * `GET /api/job-cost-sheets/plans` support. A plain read of `production_plans` (excluding
 * Cancelled, per section 1) plus the same `fms_runs.contextRef` identity check `source.ts`'s
 * `loadFmsRunIds` already uses for exclusion — no BOM/source/valuation evidence is touched,
 * so this never substitutes for or duplicates the J1/J2 engine/adapter.
 */
export async function listEligibleJobCostPlans(params: { cursor?: string; limit?: number }): Promise<{ plans: JobCostPlanOption[]; nextCursor: string | null }> {
  const actor = await authorize();
  const limit = Math.min(Math.max(Math.trunc(params.limit ?? 50) || 50, 1), 100);
  const rows = await db
    .select({ id: productionPlans.id, jobNo: productionPlans.jobNo, productSku: productionPlans.productSku, productName: productionPlans.productName, status: productionPlans.status })
    .from(productionPlans)
    .where(and(eq(productionPlans.orgId, actor.orgId), ne(productionPlans.status, "Cancelled"), params.cursor ? gt(productionPlans.id, params.cursor) : undefined))
    .orderBy(asc(productionPlans.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? page[page.length - 1].id : null;
  if (!page.length) return { plans: [], nextCursor: null };

  const fmsRows = await db
    .select({ contextRef: fmsRuns.contextRef })
    .from(fmsRuns)
    .where(and(eq(fmsRuns.orgId, actor.orgId), inArray(fmsRuns.contextRef, page.map((p) => `PRODUCTION_PLANS:${p.id}`))));
  const fmsPlanIds = new Set(fmsRows.map((r) => r.contextRef.slice("PRODUCTION_PLANS:".length)));

  const plans: JobCostPlanOption[] = page.map((p) => {
    const common = { planId: p.id, jobNo: p.jobNo, productSku: p.productSku, productName: p.productName, status: p.status };
    if (fmsPlanIds.has(p.id)) return { ...common, eligibility: "FmsUnsupported", reason: FMS_UNSUPPORTED_REASON };
    if (p.status === "Completed") return { ...common, eligibility: "FinalizableNow", reason: FINALIZABLE_REASON };
    return { ...common, eligibility: "DraftOnly", reason: DRAFT_ONLY_REASON };
  });
  return { plans, nextCursor };
}

export interface JobCostSheetSummary {
  id: string;
  planId: string;
  productSku: string;
  revision: number;
  status: "Draft" | "Finalized";
  version: number;
  asOfDate: string;
  sourceComplete: boolean;
  valuationComplete: boolean;
  canFinalize: boolean;
  fullCost: string | null;
  perGoodUnit: string | null;
  createdAt: string;
}

export function jobCostSheetSummary(sheet: JobCostSheet): JobCostSheetSummary {
  return {
    id: sheet.id, planId: sheet.planId, productSku: sheet.productSku, revision: sheet.revision, status: sheet.status, version: sheet.version,
    asOfDate: sheet.calculation.input.asOfDate, sourceComplete: sheet.calculation.sourceComplete, valuationComplete: sheet.calculation.valuationComplete,
    canFinalize: sheet.calculation.canFinalize, fullCost: sheet.calculation.totals.fullCost, perGoodUnit: sheet.calculation.totals.perGoodUnit, createdAt: sheet.createdAt,
  };
}
