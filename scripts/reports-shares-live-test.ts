/**
 * Live test for the Phase 3 "Reports/share-links" group.
 *
 * Scope: analytics.tsx's `tenantCached` removal (real Postgres reads replace a 30s TTL
 * cache) — done in an earlier pass. `src/lib/reports.ts` has no persistence of its own
 * (pure definitions + pure functions) and needed no change — also earlier. This run
 * exercises the final piece: `src/lib/platform/shares.ts` rewritten against the
 * `report_shares` table (`src/db/schema/platform.ts`) now that it exists, via
 * `src/db/repo.ts` where it fits (insertRecord for create) and direct Drizzle queries where
 * it doesn't (report_shares' primary key is `token`, not `id`, so getReportShare/
 * revokeReportShare can't use repo.ts's `findById`/`deleteById`).
 *
 *  1. Creates two throwaway orgs + admin users directly against Postgres.
 *  2. Confirms the same reads analytics.tsx's `read()` now performs uncached (listTasks,
 *     listUsers) are correctly org-scoped and reflect a write made moments earlier (the
 *     property that makes dropping the cache safe/better, not just equivalent).
 *  3. Exercises shares.ts end-to-end against the live `report_shares` table: create a share
 *     for org A, resolve it by token alone with zero org/session context (mirrors exactly
 *     how `/share/[token]/page.tsx` calls `getReportShare`), confirm tenant isolation (org B
 *     never sees org A's link, and the resolved share's Org_ID is exactly org A), confirm
 *     org B cannot revoke org A's link (the double-check on token+orgId), then confirm org
 *     A's own revoke removes it immediately (no 30s cache staleness — the old Sheets version
 *     could leave a revoked link resolving on another serverless instance for up to 30s).
 *  4. Cleans up every row it created (tasks, users, orgs, and the report_shares row — in
 *     that order, since `deleteOrganization` does not cascade into `report_shares`).
 *
 * Run: npx tsx reports-shares-live-test.ts   (from repo root, or pass an absolute path)
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
  const { runWithTenant } = await import("../src/lib/tenant");
  const { createOrganization, deleteOrganization } = await import("../src/lib/platform/registry");
  const { createUser } = await import("../src/lib/auth/users");
  const { createTask, listTasks } = await import("../src/lib/tasks");
  const {
    createReportShare,
    getReportShare,
    listReportShares,
    revokeReportShare,
  } = await import("../src/lib/platform/shares");
  const { db } = await import("../src/db/client");
  const { tasks } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");

  const stamp = Date.now();
  const orgA = await createOrganization({
    orgName: `Reports Test Org A ${stamp}`,
    ownerEmail: `reports-test-a-${stamp}@example.com`,
  });
  const orgB = await createOrganization({
    orgName: `Reports Test Org B ${stamp}`,
    ownerEmail: `reports-test-b-${stamp}@example.com`,
  });
  console.log(`Created org A ${orgA.id}, org B ${orgB.id}`);

  const ctxA = { orgId: orgA.id, org: orgA };
  const ctxB = { orgId: orgB.id, org: orgB };

  let token: string | undefined;

  try {
    console.log("\n--- 1. Users ---");
    const userA = await runWithTenant(ctxA, () =>
      createUser({
        fullName: "Admin A",
        email: `admin-a-${stamp}@example.com`,
        password: "Password123!",
        role: "Admin",
        department: "Ops",
        phoneNumber: "",
        createdBy: "system",
      })
    );
    const userB = await runWithTenant(ctxB, () =>
      createUser({
        fullName: "Admin B",
        email: `admin-b-${stamp}@example.com`,
        password: "Password123!",
        role: "Admin",
        department: "Ops",
        phoneNumber: "",
        createdBy: "system",
      })
    );
    ok(`created ${userA.User_ID} (org A), ${userB.User_ID} (org B)`);

    console.log("\n--- 2. Uncached read reflects a fresh write (what analytics.tsx's read() now does) ---");
    const before = await runWithTenant(ctxA, () => listTasks());
    assert(before.length === 0, "org A should start with no tasks");
    await runWithTenant(ctxA, () =>
      createTask({
        title: "Reports migration smoke task",
        description: "",
        assignedTo: userA.User_ID,
        assignedBy: userA.User_ID,
        priority: "Normal",
        dueDate: "2026-09-20T18:00",
        attachmentUrl: "",
        remark: "",
      })
    );
    const after = await runWithTenant(ctxA, () => listTasks());
    assert(after.length === 1, "org A should see its new task immediately, no cache staleness");
    ok("write is visible on the very next read — no TTL to wait out");

    const orgBTasks = await runWithTenant(ctxB, () => listTasks());
    assert(orgBTasks.length === 0, "org B must not see org A's task");
    ok("org B's read is still empty — tenant scoping intact");

    console.log("\n--- 3. Share link: create, resolve by token alone, tenant isolation, revoke ---");
    const share = await createReportShare({
      orgId: orgA.id,
      report: "inward", // non-personal, shareable
      label: "Smoke test link",
      rangeKey: "month",
      access: ["INWARD_ENTRY", "IQC_CHECK", "IMS_VIEW"],
      createdBy: userA.User_ID,
    });
    token = share.Token;
    ok(`share created, token=${token.slice(0, 8)}...`);

    const resolved = await getReportShare(token);
    assert(resolved !== null, "token must resolve");
    assert(resolved!.Org_ID === orgA.id, "resolved share must belong to org A");
    assert(resolved!.Org_ID !== orgB.id, "resolved share must NOT belong to org B");
    ok("token resolves to org A alone, by token — no session cookie involved (mirrors /share/[token]/page.tsx)");

    const sharesForA = await listReportShares(orgA.id);
    const sharesForB = await listReportShares(orgB.id);
    assert(sharesForA.some((s) => s.Token === token), "org A must see its own link when listing");
    assert(!sharesForB.some((s) => s.Token === token), "org B must never see org A's link");
    ok("listReportShares is correctly org-scoped — org B cannot enumerate org A's tokens");

    // Simulate an org B admin trying to revoke org A's token by guessing it — the library
    // scopes the delete to (token, orgId) together, so this must be a silent no-op.
    await revokeReportShare(orgB.id, token);
    const stillThere = await getReportShare(token);
    assert(stillThere !== null, "org B must not be able to revoke org A's share");
    ok("cross-tenant revoke attempt was a no-op — link still active");

    await revokeReportShare(orgA.id, token);
    const gone = await getReportShare(token);
    assert(gone === null, "revoked share must no longer resolve");
    ok("org A's own revoke removed the link for good");
    token = undefined; // already cleaned up
  } finally {
    console.log("\n--- Cleanup ---");
    if (token) {
      await revokeReportShare(orgA.id, token).catch(() => {});
    }
    await db.delete(tasks).where(eq(tasks.orgId, orgA.id));
    await deleteOrganization(orgA.id);
    await deleteOrganization(orgB.id);
    console.log("Deleted test tasks and both organizations.");
  }

  console.log("\nAll assertions passed.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFAILED:", err);
    process.exit(1);
  });
