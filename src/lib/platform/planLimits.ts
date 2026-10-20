import type { ModuleAccessKey } from "@/lib/moduleAccess";

/**
 * Plan tiers (2026-10-20 Razorpay self-serve billing plan, replacing the earlier
 * Trial/Growth/Scale/Enterprise split — see CLAUDE.md's billing section). Pricing
 * recommendation is based on a quick market pass against Zoho One/Zoho ERP/Odoo
 * Enterprise/Kylas (a full-ERP scope, priced flat-per-tier rather than strict per-seat, to
 * stay simple for Indian SME self-serve checkout) — launch hypotheses to validate against
 * real prospects, not to be re-derived or second-guessed here.
 *
 * Every new org starts on `Trial` (`createOrganization()`, 30 days, full feature set —
 * see `isTrialExpired()`/`tenantFromOrgId()` in src/lib/tenant.ts for where that actually
 * gets enforced). From there an org's own Admin self-serve-pays via `/billing`
 * (src/lib/billing/**, Razorpay Standard Checkout) onto `Starter`, `Growth`, or
 * `Enterprise` — a Platform Admin can still also set `organizations.plan` by hand from
 * `/platform` for support/override cases.
 */
export const PLAN_TIERS = ["Trial", "Starter", "Growth", "Enterprise"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const PLAN_NAMES: string[] = [...PLAN_TIERS];

/** Billing cycle a paid plan was bought on — "" only for Trial/never-paid orgs. */
export const BILLING_CYCLES = ["Monthly", "Yearly"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** Higher ranks a plan onto being at least as capable as a lower one. Trial is ranked 0
 * but is NEVER compared by rank for module access — see `moduleAllowedForPlan()` below,
 * which special-cases it to full access instead. The rank only matters for comparing the
 * three real paid tiers against each other. */
const PLAN_RANK: Record<PlanTier, number> = {
  Trial: 0,
  Starter: 1,
  Growth: 2,
  Enterprise: 3,
};

/**
 * An org's `plan` column is plain text with no DB-level constraint (see platform.ts's own
 * comment on that column) — a typo, a value from before this tier scheme existed, or a
 * future tier this file hasn't learned about yet must never be silently trusted. Unknown
 * values fall back to `Starter` (the lowest REAL paid tier), deliberately NOT `Trial` — a
 * corrupted/unrecognized plan value must never accidentally become time-limited via
 * `isTrialExpired()`, which only ever inspects an org whose plan is exactly `"Trial"`.
 */
export function normalizePlanTier(plan: string | null | undefined): PlanTier {
  return (PLAN_TIERS as readonly string[]).includes(plan ?? "")
    ? (plan as PlanTier)
    : "Starter";
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
  /** Razorpay order amount in paise. `null` on Trial (never purchasable). */
  monthlyPricePaise: number | null;
  /** Razorpay order amount in paise for a Yearly purchase — already discounted (~17% off,
   * i.e. "2 months free" vs. paying monthly for 12 months), not `monthlyPricePaise * 12`. */
  yearlyPricePaise: number | null;
}

export const PLAN_LIMITS: Record<PlanTier, PlanLimit> = {
  // 30-day free trial, full feature set, no user/company cap — chosen over a permanent
  // free tier so every real account is meant to convert to a paid plan.
  Trial: { maxActiveUsers: null, maxCompanies: null, trialDays: 30, monthlyPricePaise: null, yearlyPricePaise: null },
  // ₹2,999/month, up to 10 users, 1 company, every module.
  Starter: { maxActiveUsers: 10, maxCompanies: 1, trialDays: null, monthlyPricePaise: 299_900, yearlyPricePaise: 2_999_000 },
  // ₹7,999/month, up to 30 users, 1 company, every module.
  Growth: { maxActiveUsers: 30, maxCompanies: 1, trialDays: null, monthlyPricePaise: 799_900, yearlyPricePaise: 7_999_000 },
  // ₹19,999/month, unlimited users, up to 3 companies, every module, dedicated support.
  Enterprise: { maxActiveUsers: null, maxCompanies: 3, trialDays: null, monthlyPricePaise: 1_999_900, yearlyPricePaise: 19_999_000 },
};

export function getPlanLimit(plan: string): PlanLimit {
  return PLAN_LIMITS[normalizePlanTier(plan)];
}

/** The Razorpay order amount (paise) for a real paid tier + cycle, or `null` when the
 * tier/cycle combination isn't purchasable (Trial has no price at all). Used by
 * `src/lib/billing/billing.ts` to compute what to actually charge server-side — the
 * client's own request only ever names a plan/cycle, never an amount, so a tampered
 * client request can't under-charge itself. */
export function getPlanPricePaise(plan: PlanTier, cycle: BillingCycle): number | null {
  const limit = PLAN_LIMITS[plan];
  return cycle === "Yearly" ? limit.yearlyPricePaise : limit.monthlyPricePaise;
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
 * Every real paid tier is approved to include "every module" — Growth/Enterprise are
 * purely bigger user/company allowances on top of Starter, not extra modules — so every
 * existing module key defaults to `Starter` here: there is no approved tier-exclusive
 * module to encode, and inventing one would contradict the already-approved pricing copy.
 * This map exists so a FUTURE tier-exclusive module is a one-line change, not a re-plumb —
 * see `moduleAllowedForPlan`.
 */
const MODULE_MIN_TIER: Partial<Record<ModuleAccessKey, PlanTier>> = {};

function minTierFor(moduleKey: ModuleAccessKey): PlanTier {
  return MODULE_MIN_TIER[moduleKey] ?? "Starter";
}

/**
 * Is this module available on this plan at all — independent of whether the specific
 * asking USER holds the grant for it (that's `moduleAccess.ts`'s job; both must pass).
 *
 * Trial bypasses the tier ranking entirely and always returns true — a trial is explicitly
 * "full feature set," not "Starter-equivalent," and ranking Trial below Starter would
 * otherwise wrongly block a trial org from a module some future session marks
 * Growth-or-above.
 */
export function moduleAllowedForPlan(plan: string, moduleKey: ModuleAccessKey): boolean {
  const tier = normalizePlanTier(plan);
  if (tier === "Trial") return true;
  return PLAN_RANK[tier] >= PLAN_RANK[minTierFor(moduleKey)];
}
