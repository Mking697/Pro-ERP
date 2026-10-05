import { describe, expect, it } from "vitest";
import { deleteOrganization, getOrganization } from "@/lib/platform/registry";
import { createUser, updateUser, deleteUser, listUsers, UserDeletionError } from "@/lib/auth/users";
import { runWithTenant } from "@/lib/tenant";
import { makeTestOrg } from "./helpers/testOrg";

/**
 * The "last Active Admin" guard (src/lib/auth/users.ts) protects an organization from
 * ever being left with nobody who can manage users or settings. It used to be a plain
 * read-then-decide check in updateUser()/deleteUser() — "is there another Active Admin?"
 * read first, then the demotion/delete applied — which has a real race: two concurrent
 * requests each acting on a different one of the last two Admins can both see "one other
 * Admin still exists" at read time and both succeed, leaving zero. The fix folds the
 * EXISTS check into the UPDATE/DELETE statement's own WHERE clause so Postgres decides
 * atomically which (if any) statement actually matches a row.
 *
 * `createOrganization()` seeds no user at all (see src/lib/platform/registry.ts) — every
 * Admin in these tests is created explicitly via createUser().
 *
 * These tests exercise both the serial behaviour (single actor, in order) and the actual
 * race (two concurrent requests against the last two Admins, fired with Promise.all so
 * they genuinely overlap instead of running one after the other).
 */
describe("last-Admin atomic guard", () => {
  it("refuses to demote the organization's only Active Admin", async () => {
    const org = await makeTestOrg("LastAdminDemote");
    try {
      await runWithTenant({ orgId: org.id, org }, async () => {
        const onlyAdmin = await createUser({
          fullName: "Sole Admin",
          email: `sole-admin-${org.id}@example.com`,
          password: "Password123!",
          role: "Admin",
          department: "Management",
          phoneNumber: "9990000010",
          createdBy: "SYSTEM",
        });

        let refusal: unknown;
        try {
          await updateUser(onlyAdmin.User_ID, { role: "Staff" });
        } catch (err) {
          refusal = err;
        }
        expect(refusal).toBeInstanceOf(UserDeletionError);
        expect((refusal as Error).message).toContain("aakhri Admin");

        const stillAdmin = (await listUsers()).find((u) => u.User_ID === onlyAdmin.User_ID);
        expect(stillAdmin?.Role).toBe("Admin");
      });
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });

  it("allows demoting an Admin when another Active Admin still exists", async () => {
    const org = await makeTestOrg("LastAdminDemoteOk");
    try {
      await runWithTenant({ orgId: org.id, org }, async () => {
        const first = await createUser({
          fullName: "Admin One",
          email: `admin-one-${org.id}@example.com`,
          password: "Password123!",
          role: "Admin",
          department: "Management",
          phoneNumber: "9990000014",
          createdBy: "SYSTEM",
        });
        await createUser({
          fullName: "Admin Two",
          email: `admin-two-${org.id}@example.com`,
          password: "Password123!",
          role: "Admin",
          department: "Management",
          phoneNumber: "9990000015",
          createdBy: "SYSTEM",
        });

        // Two Admins exist — demoting one must succeed since the other remains.
        const updated = await updateUser(first.User_ID, { role: "Staff" });
        expect(updated.Role).toBe("Staff");
      });
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });

  it("refuses to deactivate the organization's only Active Admin", async () => {
    const org = await makeTestOrg("LastAdminDeactivate");
    try {
      await runWithTenant({ orgId: org.id, org }, async () => {
        const onlyAdmin = await createUser({
          fullName: "Sole Admin 2",
          email: `sole-admin2-${org.id}@example.com`,
          password: "Password123!",
          role: "Admin",
          department: "Management",
          phoneNumber: "9990000011",
          createdBy: "SYSTEM",
        });

        let refusal: unknown;
        try {
          await updateUser(onlyAdmin.User_ID, { status: "Inactive" });
        } catch (err) {
          refusal = err;
        }
        expect(refusal).toBeInstanceOf(UserDeletionError);

        const stillActive = (await listUsers()).find((u) => u.User_ID === onlyAdmin.User_ID);
        expect(stillActive?.Status).toBe("Active");
      });
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });

  it("refuses to delete the organization's only Active Admin", async () => {
    const org = await makeTestOrg("LastAdminDelete");
    try {
      await runWithTenant({ orgId: org.id, org }, async () => {
        const onlyAdmin = await createUser({
          fullName: "Sole Admin 3",
          email: `sole-admin3-${org.id}@example.com`,
          password: "Password123!",
          role: "Admin",
          department: "Management",
          phoneNumber: "9990000012",
          createdBy: "SYSTEM",
        });
        const bystander = await createUser({
          fullName: "Bystander Staff",
          email: `bystander-${org.id}@example.com`,
          password: "Password123!",
          role: "Staff",
          department: "Ops",
          phoneNumber: "9990000016",
          createdBy: "SYSTEM",
        });

        let refusal: unknown;
        try {
          await deleteUser(onlyAdmin.User_ID, bystander.User_ID);
        } catch (err) {
          refusal = err;
        }
        expect(refusal).toBeInstanceOf(UserDeletionError);

        const stillThere = (await listUsers()).find((u) => u.User_ID === onlyAdmin.User_ID);
        expect(stillThere).toBeDefined();
      });
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });

  /**
   * The actual race the atomic WHERE-clause fix exists to close: exactly two Active
   * Admins exist, and two requests fire AT THE SAME TIME, each demoting a different one
   * of them. A read-then-check version would have both requests read "one other Admin
   * still exists" before either write lands, and both would succeed — zero Admins left.
   * With the fix, Postgres serializes the two UPDATEs; whichever commits first makes the
   * other's own EXISTS clause evaluate false, so exactly one of the two must fail and at
   * least one Admin must survive.
   */
  it("concurrent demotion of both of the last two Admins leaves exactly one Admin standing", async () => {
    const org = await makeTestOrg("LastAdminRace");
    try {
      await runWithTenant({ orgId: org.id, org }, async () => {
        const adminA = await createUser({
          fullName: "Admin A",
          email: `admin-a-${org.id}@example.com`,
          password: "Password123!",
          role: "Admin",
          department: "Management",
          phoneNumber: "9990000017",
          createdBy: "SYSTEM",
        });
        const adminB = await createUser({
          fullName: "Admin B",
          email: `admin-b-${org.id}@example.com`,
          password: "Password123!",
          role: "Admin",
          department: "Management",
          phoneNumber: "9990000018",
          createdBy: "SYSTEM",
        });

        // Exactly two Admins exist now: adminA and adminB. Fire both demotions
        // concurrently via Promise.allSettled so a rejection from either doesn't short-
        // circuit the other.
        const results = await Promise.allSettled([
          updateUser(adminA.User_ID, { role: "Staff" }),
          updateUser(adminB.User_ID, { role: "Staff" }),
        ]);

        const fulfilled = results.filter((r) => r.status === "fulfilled");
        const rejected = results.filter((r) => r.status === "rejected");

        // At least one must have been refused by the atomic guard — both succeeding would
        // mean the race reintroduced a zero-Admin organization.
        expect(rejected.length).toBeGreaterThanOrEqual(1);
        for (const r of rejected) {
          expect((r as PromiseRejectedResult).reason).toBeInstanceOf(UserDeletionError);
        }

        const finalUsers = await listUsers();
        const remainingAdmins = finalUsers.filter(
          (u) => u.Role === "Admin" && u.Status === "Active"
        );
        // Exactly one Admin must remain — never zero, and the fulfilled count confirms
        // at most one demotion was actually allowed through.
        expect(remainingAdmins.length).toBe(1);
        expect(fulfilled.length).toBe(1);
      });
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });
});
