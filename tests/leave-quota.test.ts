import { describe, expect, it } from "vitest";
import { deleteOrganization, getOrganization } from "@/lib/platform/registry";
import { createUser } from "@/lib/auth/users";
import { runWithTenant } from "@/lib/tenant";
import { createLeave, LeaveError } from "@/lib/leave/leaves";
import { setLeaveQuota } from "@/lib/leave/quotas";
import { makeTestOrg } from "./helpers/testOrg";

/**
 * Leave balance/quota (2026-09-22) — a flat annual quota per leave type, opt-in per type,
 * enforced as a hard filing-time refusal in createLeave() (src/lib/leave/leaves.ts). This
 * exercises the three cases the feature is built around: a request that exactly exhausts a
 * configured quota succeeds, a request that would push it over is refused outright (not a
 * warning), and a leave type with no quota configured is never capped regardless of how
 * many days are requested.
 */
describe("leave quota enforcement", () => {
  it("blocks a request that exceeds a configured quota, but never caps a type with no quota", async () => {
    const org = await makeTestOrg("LeaveQuota");

    try {
      await runWithTenant({ orgId: org.id, org }, async () => {
        const doer = await createUser({
          fullName: "Quota Doer",
          email: `quota-doer-${org.id}@example.com`,
          password: "Password123!",
          role: "Staff",
          department: "Ops",
          phoneNumber: "9990000001",
          createdBy: "SYSTEM",
        });
        const buddy = await createUser({
          fullName: "Quota Buddy",
          email: `quota-buddy-${org.id}@example.com`,
          password: "Password123!",
          role: "Staff",
          department: "Ops",
          phoneNumber: "9990000002",
          createdBy: "SYSTEM",
        });

        // Casual capped at 5 days/year; Sick left unconfigured (unlimited).
        await setLeaveQuota("Casual", 5);

        // Uses exactly the full quota (5 inclusive days) — must succeed.
        const fullQuotaLeave = await createLeave({
          doerId: doer.User_ID,
          leaveType: "Casual",
          startDate: "2026-11-01",
          endDate: "2026-11-05",
          reason: "Using full quota",
          buddyId: buddy.User_ID,
          isEmergency: false,
          filedBy: doer.User_ID,
        });
        expect(fullQuotaLeave.status).toBe("Approved");

        // One more day, same year, same type — must be refused outright, not warned. The
        // refusal message should name the type, the remaining balance, and what was asked for.
        let refusal: unknown;
        try {
          await createLeave({
            doerId: doer.User_ID,
            leaveType: "Casual",
            startDate: "2026-11-06",
            endDate: "2026-11-06",
            reason: "One day over quota",
            buddyId: buddy.User_ID,
            isEmergency: false,
            filedBy: doer.User_ID,
          });
        } catch (err) {
          refusal = err;
        }
        expect(refusal).toBeInstanceOf(LeaveError);
        const refusalMessage = (refusal as Error).message;
        expect(refusalMessage).toContain("Casual");
        expect(refusalMessage).toContain("0");
        expect(refusalMessage).toContain("1");

        // A different leave type with no quota configured is never capped, however many
        // days are requested.
        const unlimitedLeave = await createLeave({
          doerId: doer.User_ID,
          leaveType: "Sick",
          startDate: "2027-01-01",
          endDate: "2027-01-20",
          reason: "No quota configured for Sick",
          buddyId: buddy.User_ID,
          isEmergency: false,
          filedBy: doer.User_ID,
        });
        expect(unlimitedLeave.status).toBe("Approved");
      });
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });
});
