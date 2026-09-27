import type { ModuleAccessKey } from "@/lib/moduleAccess";

/**
 * Plan tiers (2026-09-25 paid-tiers plan, replacing 2026-09-22's flat Free(5 users)/Pro
 * (unlimited) split) — still no payment gateway anywhere in this codebase; a Platform
 * Admin sets `organizations.plan` by hand from `/platform` (PATCH handler at
 * src/app/api/platform/organizations/[orgId]/route.ts). This file is the one place that
 * turns that plain string column into real limits and real module gating.
 *
 * Every new org starts on `Trial` (`createOrganization()`, 14 days, full feature set —
 * see `isTrialExpired()`/`tenantFromOrgId()` in src/lib/tenant.ts for where that actually
 * gets enforced). From there a Platform Admin moves it onto `Growth`, `Scale`, or
 * `Enterprise`.
 *
 * Pricing/limits below are the exact numbers approved in CLAUDE.md's "Paid plan tiers"
 * planning section (2026-09-25) — launch hypotheses to validate against real prospects,
 * not to be re-derived or second-guessed here.
 */
export const PLAN_TIERS = ["Trial", "Growth", "Scale", "Enterprise"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const PLAN_NAMES: string[] = [...PLAN_TIERS];

/** Higher ranks a plan onto being at least as capable as a lower one. Trial is ranked 0
 * but is NEVER compared by rank for module access — see `moduleAllowedForPlan()` below,
 * which special-cases it to full access instead. The rank only matters for comparing the
 * three real paid tiers against each other. */
const PLAN_RANK: Record<PlanTier, number> = {
  Trial: 0,
  Growth: 1,
  Scale: 2,
  Enterprise: 3,
};

/**
 * An org's `plan` column is plain text with no DB-level constraint (see platform.ts's own
 * comment on that column) — a typo, a value from before this tier scheme existed, or a
 * future tier this file hasn't learned about yet must never be silently trusted. Unknown
 * values fall back to `Growth` (the lowest REAL paid tier), deliberately NOT `Trial` — a
 * corrupted/unrecognized plan value must never accidentally become time-limited via
 * `isTrialExpired()`, which only ever inspects an org whose plan is exactly `"Trial"`.
 */
export function normalizePlanTier(plan: string | null | undefined): PlanTier {
  return (PLAN_TIERS as readonly string[]).includes(plan ?? "")
    ? (plan as PlanTier)
    : "Growth";
}

export interface PlanLimit {
  /** `null` means unlimited. */
  maxActiveUsers: number | null;
  /**
   * `null` means unlimited. NOT enforced anywhere today — this codebase has no
   * multi-company concept at all (one org is one tenant, full stop). Carried here purely
   * as the approved plan's own stated number, ready for whichever future session actually
   * builds multi-company support to enforce against.
   */
  maxCompanies: number | null;
  /** Only set for Trial. */
  trialDays: number | null;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimit> = {
  // 14-day free trial, full feature set, no user/company cap — chosen over a permanent
  // free tier so every real account is meant to convert to a paid plan.
  Trial: { maxActiveUsers: null, maxCompanies: null, trialDays: 14 },
  // ₹3,999/month launch price (rising to ₹5,999/month after an introductory period —
  // pricing/billing mechanics, not enforced here), up to 20 users then ₹249/extra
  // user/month, 1 company, every module.
  Growth: { maxActiveUsers: 20, maxCompanies: 1, trialDays: null },
  // ₹14,999/month, unlimited users, up to 3 companies then ₹4,999/extra company/month.
  Scale: { maxActiveUsers: null, maxCompanies: 3, trialDays: null },
  // Custom pricing, unlimited everything, priced for once the app is off Vercel/Neon onto
  // dedicated infra.
  Enterprise: { maxActiveUsers: null, maxCompanies: null, trialDays: null },
};

export function getPlanLimit(plan: string): PlanLimit {
  return PLAN_LIMITS[normalizePlanTier(plan)];
}

/**
 * A Trial org's own end date, or null once it's on a real plan (or has no end date set —
 * pre-existing rows created before this column existed). Only `plan === "Trial"` rows are
 * ever time-limited; moving an org onto any real paid plan makes this permanently
 * irrelevant regardless of what `trialEndsAt` still holds.
 */
export function isTrialExpired(org: {
  plan: string;
  trialEndsAt: Date | string | null;
}): boolean {
  if (normalizePlanTier(org.plan) !== "Trial") return false;
  if (!org.trialEndsAt) return false;
  return new Date(org.trialEndsAt).getTime() < Date.now();
}

/**
 * Which tier a module first becomes available at.
 *
 * CLAUDE.md's own approved plan describes `Growth` — the LOWEST real paid tier — as
 * already including "every module," with Scale/Enterprise described purely as bigger
 * user/company allowances on top ("unlimited everything"), not as unlocking anything
 * Growth doesn't have. So every existing module key defaults to `Growth` here: there is
 * no approved Scale-or-Enterprise-exclusive module to encode, and inventing one would
 * contradict the already-approved pricing copy. This map exists so a FUTURE
 * tier-exclusive module is a one-line change, not a re-plumb — see `moduleAllowedForPlan`.
 */
const MODULE_MIN_TIER: Partial<Record<ModuleAccessKey, PlanTier>> = {};

function minTierFor(moduleKey: ModuleAccessKey): PlanTier {
  return MODULE_MIN_TIER[moduleKey] ?? "Growth";
}

/**
 * Is this module available on this plan at all — independent of whether the specific
 * asking USER holds the grant for it (that's `moduleAccess.ts`'s job; both must pass).
 *
 * Trial bypasses the tier ranking entirely and always returns true — a trial is explicitly
 * "full feature set," not "Growth-equivalent," and ranking Trial below Growth would
 * otherwise wrongly block a trial org from a module some future session marks
 * Scale-or-above.
 */
export function moduleAllowedForPlan(plan: string, moduleKey: ModuleAccessKey): boolean {
  const tier = normalizePlanTier(plan);
  if (tier === "Trial") return true;
  return PLAN_RANK[tier] >= PLAN_RANK[minTierFor(moduleKey)];
}
