/**
 * Usage limits per plan (2026-09-22) — deliberately just this, by explicit user choice
 * over building real Razorpay subscription billing. There is no payment gateway anywhere
 * in this codebase; `organizations.plan` is set to "Free" at signup and changed only by a
 * Platform Admin from `/platform` (see the PATCH handler at
 * src/app/api/platform/organizations/[orgId]/route.ts, which already accepted a `plan`
 * field before this file existed — this is the first thing that actually reads it for
 * anything other than display).
 *
 * `null` means unlimited. A plan not listed here falls back to `Free`'s limits, so an org
 * whose `plan` column holds some future/typo'd value is never accidentally unlimited.
 */
export interface PlanLimit {
  maxActiveUsers: number | null;
}

export const PLAN_LIMITS: Record<string, PlanLimit> = {
  Free: { maxActiveUsers: 5 },
  Pro: { maxActiveUsers: null },
};

export const PLAN_NAMES = Object.keys(PLAN_LIMITS);

export function getPlanLimit(plan: string): PlanLimit {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.Free;
}
