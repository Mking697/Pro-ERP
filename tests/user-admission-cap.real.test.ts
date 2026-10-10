import { describe, expect, it } from "vitest";
import { deleteOrganization, getOrganization, updateOrganization } from "@/lib/platform/registry";
import { createUser, updateUser, listUsers } from "@/lib/auth/users";
import { runWithTenant } from "@/lib/tenant";
import { makeTestOrg } from "./helpers/testOrg";

/**
 * OPS-03: real-driver proof that the active-user cap's org-serialized admission check
 * (src/lib/auth/users.ts's assertActiveUserCapAvailable() + runInTenantTransaction()) is
 * actually backed by Postgres's own pg_advisory_xact_lock, not just the DB-free mocked
 * queue in tests/user-admission-unit.test.ts. Growth is the one plan tier with a finite,
 * testable cap (20 — see src/lib/platform/planLimits.ts); the org is bumped onto it via
 * updateOrganization() exactly like a Platform Admin would from /platform.
 */
describe("active-user cap admission (real Postgres advisory lock)", () => {
  it("rejects reactivating a disabled user when the org's Growth-plan cap (20) is already full", async () => {
    const org = await makeTestOrg("CapReactivateReject");
    try {
      await runWithTenant({ orgId: org.id, org }, async () => {
        for (let i = 0; i < 20; i += 1) {
          await createUser({
            fullName: `Cap Filler ${i}`,
            email: `cap-filler-${i}-${org.id}@example.com`,
            password: "Password123!",
            role: "Staff",
            department: "Ops",
            phoneNumber: `999100${String(i).padStart(4, "0")}`,
            createdBy: "SYSTEM",
          });
        }

        const disabled = await createUser({
          fullName: "Over Cap Disabled",
          email: `over-cap-disabled-${org.id}@example.com`,
          password: "Password123!",
          role: "Staff",
          department: "Ops",
          phoneNumber: "9991009999",
          createdBy: "SYSTEM",
        });
        await updateUser(disabled.User_ID, { status: "Inactive" });
        // 20 Active (the fillers) + this 1 Inactive user now exist, all while still on
        // unlimited Trial. Moving onto Growth (cap 20) makes the org already exactly at
        // capacity before the reactivation attempt below.
        await updateOrganization(org.id, { plan: "Growth" });

        let refusal: unknown;
        try {
          await updateUser(disabled.User_ID, { status: "Active" });
        } catch (err) {
          refusal = err;
        }
        expect(refusal).toBeInstanceOf(Error);
        expect((refusal as Error).message).toMatch(/active users ho sakte hain/);

        const stillInactive = (await listUsers()).find((u) => u.User_ID === disabled.User_ID);
        expect(stillInactive?.Status).toBe("Inactive");
      });
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  }, 60000);

  /**
   * The actual race the advisory lock exists to close: the org has exactly one available
   * seat left under its Growth cap (19 Active, cap 20), and two disabled users are
   * reactivated AT THE SAME TIME. Without the org-serialized admission check, both could
   * read "19 < 20" before either commits and both succeed — 21 Active users, over cap.
   * With `pg_advisory_xact_lock` (via runInTenantTransaction), the second transaction
   * blocks until the first commits, then re-reads the now-updated count and correctly
   * refuses.
   */
  it("allows exactly one of two concurrent reactivations racing for the organization's last available Growth-plan seat", async () => {
    const org = await makeTestOrg("CapReactivateRace");
    try {
      await runWithTenant({ orgId: org.id, org }, async () => {
        for (let i = 0; i < 19; i += 1) {
          await createUser({
            fullName: `Cap Filler ${i}`,
            email: `race-filler-${i}-${org.id}@example.com`,
            password: "Password123!",
            role: "Staff",
            department: "Ops",
            phoneNumber: `999200${String(i).padStart(4, "0")}`,
            createdBy: "SYSTEM",
          });
        }

        const candidateA = await createUser({
          fullName: "Race Candidate A",
          email: `race-a-${org.id}@example.com`,
          password: "Password123!",
          role: "Staff",
          department: "Ops",
          phoneNumber: "9992009901",
          createdBy: "SYSTEM",
        });
        const candidateB = await createUser({
          fullName: "Race Candidate B",
          email: `race-b-${org.id}@example.com`,
          password: "Password123!",
          role: "Staff",
          department: "Ops",
          phoneNumber: "9992009902",
          createdBy: "SYSTEM",
        });
        await updateUser(candidateA.User_ID, { status: "Inactive" });
        await updateUser(candidateB.User_ID, { status: "Inactive" });
        // 19 Active (the fillers) + 2 Inactive candidates, still on unlimited Trial.
        // Moving onto Growth (cap 20) now leaves exactly 1 free seat.
        await updateOrganization(org.id, { plan: "Growth" });

        const results = await Promise.allSettled([
          updateUser(candidateA.User_ID, { status: "Active" }),
          updateUser(candidateB.User_ID, { status: "Active" }),
        ]);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");
        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(1);
        expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
        expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(
          /active users ho sakte hain/
        );

        const finalUsers = await listUsers();
        const activeCount = finalUsers.filter((u) => u.Status === "Active").length;
        // Never 21 — the real advisory lock held the cap under genuine concurrency.
        expect(activeCount).toBe(20);
      });
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  }, 60000);
});
