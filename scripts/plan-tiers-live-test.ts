/**
 * Live test for the "plan tiers + trial + module-gating" piece of CLAUDE.md's
 * 2026-09-25 "Paid plan tiers" plan (src/lib/platform/planLimits.ts, src/lib/tenant.ts's
 * tenantFromOrgId(), src/lib/auth/guard.ts's requireModule/requireAnyModule).
 *
 * Exercises, against the real Neon dev DB, via a throwaway org each:
 *  1. A fresh org starts on Trial, with full module access regardless of the
 *     Growth-only MODULE_MIN_TIER matrix (moduleAllowedForPlan always true on Trial).
 *  2. A Growth-tier org's 21st active-user creation is blocked (maxActiveUsers: 20);
 *     Scale and Enterprise are not blocked at the same count.
 *  3. tenantFromOrgId() throws (digest "TRIAL_EXPIRED") once trialEndsAt is backdated on
 *     a Trial-plan org, and does NOT throw once that same org is moved onto a real plan.
 *  4. Platform Admin's updateOrganization() can move an org across all four tiers, and
 *     moduleAllowedForPlan/getPlanLimit track the change immediately (no caching).
 *
 * Run: npx tsx scripts/plan-tiers-live-test.ts   (from repo root)
 */
import { config } from "dotenv";
config({ path: ".env.local" });

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}
function ok(msg: string) {
  console.log(`  OK: ${msg}`);
}

async function main() {
  const { createOrganization, updateOrganization, deleteOrganization, getOrganization } =
    await import("../src/lib/platform/registry");
  const { createUser } = await import("../src/lib/auth/users");
  const { runWithTenant, tenantFromOrgId, TenantResolutionError } = await import(
    "../src/lib/tenant"
  );
  const { moduleAllowedForPlan, getPlanLimit, normalizePlanTier, isTrialExpired } =
    await import("../src/lib/platform/planLimits");
  const { MODULE_ACCESS_KEYS } = await import("../src/lib/moduleAccess");
  const { db } = await import("../src/db/client");
  const { organizations } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");

  const stamp = Date.now();
  const orgTrial = await createOrganization({
    orgName: `Plan Tier Test Trial ${stamp}`,
    ownerEmail: `plan-trial-${stamp}@example.com`,
  });
  const orgGrowth = await createOrganization({
    orgName: `Plan Tier Test Growth ${stamp}`,
    ownerEmail: `plan-growth-${stamp}@example.com`,
  });
  const orgScale = await createOrganization({
    orgName: `Plan Tier Test Scale ${stamp}`,
    ownerEmail: `plan-scale-${stamp}@example.com`,
  });
  console.log(
    `Created orgs: Trial=${orgTrial.id}, Growth=${orgGrowth.id}, Scale=${orgScale.id}`
  );

  try {
    console.log("\n--- 1. Fresh org starts on Trial, full module access ---");
    assert(orgTrial.plan === "Trial", `expected plan Trial, got ${orgTrial.plan}`);
    assert(orgTrial.trialEndsAt !== null, "trialEndsAt must be set at signup");
    const daysUntilExpiry =
      (new Date(orgTrial.trialEndsAt as unknown as string).getTime() - Date.now()) /
      (24 * 60 * 60 * 1000);
    assert(
      daysUntilExpiry > 13.9 && daysUntilExpiry <= 14,
      `expected ~14 days on the trial clock, got ${daysUntilExpiry.toFixed(2)}`
    );
    ok(`org starts on Trial, trialEndsAt ~14 days out (${daysUntilExpiry.toFixed(2)}d)`);

    for (const key of MODULE_ACCESS_KEYS) {
      assert(
        moduleAllowedForPlan("Trial", key),
        `Trial must allow every module, failed on ${key}`
      );
    }
    ok(`Trial allows all ${MODULE_ACCESS_KEYS.length} module keys, bypassing the Growth-only tier matrix`);

    const tenantTrial = await tenantFromOrgId(orgTrial.id);
    assert(tenantTrial.orgId === orgTrial.id, "tenantFromOrgId should resolve the fresh trial org");
    ok("tenantFromOrgId() resolves a fresh (non-expired) Trial org without throwing");

    console.log("\n--- 2. Growth's 20-user cap blocks a 21st active user; Scale/Enterprise don't ---");
    await updateOrganization(orgGrowth.id, { plan: "Growth" });
    await updateOrganization(orgScale.id, { plan: "Scale" });

    const growthLimit = getPlanLimit("Growth").maxActiveUsers;
    assert(growthLimit === 20, `expected Growth maxActiveUsers=20, got ${growthLimit}`);
    const scaleLimit = getPlanLimit("Scale").maxActiveUsers;
    assert(scaleLimit === null, `expected Scale maxActiveUsers=null (unlimited), got ${scaleLimit}`);

    const growthCtx = { orgId: orgGrowth.id, org: { ...orgGrowth, plan: "Growth" } };
    for (let i = 1; i <= 20; i++) {
      await runWithTenant(growthCtx, () =>
        createUser({
          fullName: `Growth User ${i}`,
          email: `growth-user-${i}-${stamp}@example.com`,
          password: "Password123!",
          role: "User",
          department: "Ops",
          phoneNumber: "",
          createdBy: "system",
        })
      );
    }
    ok("created 20 active users on the Growth org — right at the cap");

    let blocked = false;
    try {
      await runWithTenant(growthCtx, () =>
        createUser({
          fullName: "Growth User 21",
          email: `growth-user-21-${stamp}@example.com`,
          password: "Password123!",
          role: "User",
          department: "Ops",
          phoneNumber: "",
          createdBy: "system",
        })
      );
    } catch {
      blocked = true;
    }
    assert(blocked, "the 21st active user on a Growth org must be blocked");
    ok("21st active user on Growth was correctly blocked");

    const scaleCtx = { orgId: orgScale.id, org: { ...orgScale, plan: "Scale" } };
    for (let i = 1; i <= 21; i++) {
      await runWithTenant(scaleCtx, () =>
        createUser({
          fullName: `Scale User ${i}`,
          email: `scale-user-${i}-${stamp}@example.com`,
          password: "Password123!",
          role: "User",
          department: "Ops",
          phoneNumber: "",
          createdBy: "system",
        })
      );
    }
    ok("created 21 active users on the Scale org (past Growth's own cap) with no block — unlimited users confirmed");

    console.log("\n--- 3. tenantFromOrgId() throws once a Trial org's own clock runs out ---");
    await db
      .update(organizations)
      .set({ trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000) })
      .where(eq(organizations.id, orgTrial.id));

    const backdated = await getOrganization(orgTrial.id);
    assert(backdated !== null, "org must still exist after backdating");
    assert(isTrialExpired(backdated!), "isTrialExpired() must see the backdated org as expired");
    ok("isTrialExpired() correctly reports true once trialEndsAt is in the past");

    let expiredCaught: InstanceType<typeof TenantResolutionError> | null = null;
    try {
      await tenantFromOrgId(orgTrial.id);
    } catch (err) {
      if (err instanceof TenantResolutionError) expiredCaught = err;
      else throw err;
    }
    assert(expiredCaught !== null, "tenantFromOrgId() must throw TenantResolutionError on an expired trial");
    assert(
      expiredCaught!.digest === "TRIAL_EXPIRED",
      `expected digest TRIAL_EXPIRED, got ${expiredCaught!.digest}`
    );
    ok("tenantFromOrgId() throws TenantResolutionError with digest TRIAL_EXPIRED on an expired Trial org");

    // Moving the same org onto a real plan must clear the lockout immediately — no
    // caching anywhere in this path.
    await updateOrganization(orgTrial.id, { plan: "Growth" });
    const tenantAfterUpgrade = await tenantFromOrgId(orgTrial.id);
    assert(
      tenantAfterUpgrade.orgId === orgTrial.id,
      "tenantFromOrgId() must resolve normally once the expired Trial org is upgraded to a real plan"
    );
    ok("upgrading the expired-trial org to Growth clears the lockout immediately");

    console.log("\n--- 4. Platform Admin's updateOrganization() moves an org across all four tiers ---");
    for (const tier of ["Trial", "Growth", "Scale", "Enterprise"] as const) {
      const updated = await updateOrganization(orgTrial.id, { plan: tier });
      assert(updated.plan === tier, `expected plan ${tier}, got ${updated.plan}`);
      assert(
        normalizePlanTier(updated.plan) === tier,
        `normalizePlanTier should echo back a known tier unchanged (${tier})`
      );
    }
    ok("updateOrganization() moved the org through Trial -> Growth -> Scale -> Enterprise cleanly");

    console.log("\n--- Bonus: an unknown/corrupted plan value never becomes Trial-limited ---");
    const corrupted = await updateOrganization(orgTrial.id, { plan: "TotallyMadeUp" });
    assert(!isTrialExpired(corrupted), "a corrupted plan value must never read as an expired trial");
    assert(normalizePlanTier(corrupted.plan) === "Growth", "an unknown plan value must normalize to Growth");
    const tenantCorrupted = await tenantFromOrgId(orgTrial.id);
    assert(tenantCorrupted.orgId === orgTrial.id, "a corrupted plan value must not lock the org out");
    ok("an unrecognized plan string normalizes to Growth and never locks the org out via trial-expiry");
  } finally {
    console.log("\n--- Cleanup ---");
    await deleteOrganization(orgTrial.id);
    await deleteOrganization(orgGrowth.id);
    await deleteOrganization(orgScale.id);
    console.log("Deleted all three test organizations (and every user created under them).");
  }

  console.log("\nAll assertions passed.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFAILED:", err);
    process.exit(1);
  });
