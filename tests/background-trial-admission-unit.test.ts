import { describe, expect, it, vi } from "vitest";

/**
 * OPS-03 (b): explicit cron/background tenant context (src/lib/platform/runner.ts's
 * forEachActiveOrganization) used to build its TenantContext directly from
 * listOrganizations()'s raw rows — filtering only on `status === "Active"` — completely
 * bypassing tenantFromOrgId()'s trial-expiry check that every INTERACTIVE request already
 * goes through via getTenant(). An org whose status is still "Active" but whose 14-day
 * trial has expired would therefore keep having cron-triggered business records (e.g. new
 * recurring task occurrences) generated for it, while an interactive user from the same
 * org gets hard-blocked with TRIAL_EXPIRED on every request.
 *
 * POLICY DECISION (documented, conservative, overridable default — not a silent guess):
 * background/cron generation for a trial-expired org is now skipped entirely for that
 * org's run, by routing through the exact same tenantFromOrgId() the interactive path
 * uses instead of re-deriving tenant context from the raw org row. This mirrors existing
 * behavior rather than inventing a new independent rule, and is captured as a normal
 * per-org failure (ok:false, same shape every other org-specific cron failure already
 * uses) so it never aborts any other tenant's run. A different business choice — e.g.
 * continue generating but mark the result read-only — remains a valid alternative; this
 * file (src/lib/platform/runner.ts) is the one place to change if the business picks that
 * instead.
 */
const h = vi.hoisted(() => ({
  orgs: [
    { id: "ORG-ACTIVE", orgName: "Active Co", status: "Active", plan: "Growth", trialEndsAt: null },
    {
      id: "ORG-EXPIRED",
      orgName: "Expired Trial Co",
      status: "Active",
      plan: "Trial",
      trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    },
  ],
}));

vi.mock("@/lib/platform/registry", () => ({
  listOrganizations: async () => h.orgs,
  getOrganization: async (orgId: string) => h.orgs.find((o) => o.id === orgId) ?? null,
}));

const { forEachActiveOrganization } = await import("@/lib/platform/runner");

describe("background/cron tenant admission mirrors interactive trial-expiry policy", () => {
  it("skips generation entirely for an org whose trial has expired, without running the job fn", async () => {
    const fn = vi.fn(async (ctx: { orgId: string }) => `ran:${ctx.orgId}`);

    const results = await forEachActiveOrganization(fn);

    const expired = results.find((r) => r.orgId === "ORG-EXPIRED");
    expect(expired?.ok).toBe(false);
    expect(expired?.error).toMatch(/trial khatm ho gaya hai/);
    expect(fn.mock.calls.some(([ctx]) => ctx.orgId === "ORG-EXPIRED")).toBe(false);

    const active = results.find((r) => r.orgId === "ORG-ACTIVE");
    expect(active?.ok).toBe(true);
    expect(active?.result).toBe("ran:ORG-ACTIVE");
    expect(fn.mock.calls.some(([ctx]) => ctx.orgId === "ORG-ACTIVE")).toBe(true);
  });
});
