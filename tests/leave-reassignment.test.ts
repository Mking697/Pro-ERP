import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { deleteOrganization, getOrganization } from "@/lib/platform/registry";
import { createUser } from "@/lib/auth/users";
import { runWithTenant } from "@/lib/tenant";
import { createTask, listTasks, markTaskDone } from "@/lib/tasks";
import { createLeave, cancelLeave } from "@/lib/leave/leaves";
import { createFmsTemplate, deleteFmsTemplate } from "@/lib/fms/templates";
import { startFmsInstance } from "@/lib/fms/engine";
import { db } from "@/db/client";
import { fmsRuns } from "@/db/schema";
import { todayIST } from "@/lib/dateUtil";
import { makeTestOrg } from "./helpers/testOrg";

/**
 * The asymmetric revert rule CLAUDE.md calls out for src/lib/leave/reassignment.ts: a
 * leave's reassignment only ever reverts what is still Pending and still held by the
 * buddy — it must never blind-revert everything the leave ever touched. No approval chain
 * is configured for this throwaway org, so createLeave() auto-approves and activates
 * immediately (its date range covers "today"), which is what lets this test exercise
 * activation and reversion synchronously in one pass.
 */
describe("leave reassignment / revert", () => {
  it("reassigns open work to the buddy, keeps buddy-completed work, and only reverts what's still pending", async () => {
    const org = await makeTestOrg("Leave");

    try {
      const result = await runWithTenant({ orgId: org.id, org }, async () => {
        const doer = await createUser({
          fullName: "Leave Doer",
          email: `leave-doer-${org.id}@example.com`,
          password: "Password123!",
          role: "Staff",
          department: "Ops",
          phoneNumber: "9990000001",
          createdBy: "SYSTEM",
        });
        const buddy = await createUser({
          fullName: "Leave Buddy",
          email: `leave-buddy-${org.id}@example.com`,
          password: "Password123!",
          role: "Staff",
          department: "Ops",
          phoneNumber: "9990000002",
          createdBy: "SYSTEM",
        });

        const taskCompletedByBuddy = await createTask({
          title: "Task buddy will finish",
          description: "",
          assignedTo: doer.User_ID,
          assignedBy: doer.User_ID,
          priority: "Medium",
          dueDate: `${todayIST()}T23:59`,
          attachmentUrl: "",
          remark: "",
        });
        const taskStillPending = await createTask({
          title: "Task buddy leaves pending",
          description: "",
          assignedTo: doer.User_ID,
          assignedBy: doer.User_ID,
          priority: "Medium",
          dueDate: `${todayIST()}T23:59`,
          attachmentUrl: "",
          remark: "",
        });

        const today = todayIST();
        const leave = await createLeave({
          doerId: doer.User_ID,
          leaveType: "Casual",
          startDate: today,
          endDate: today,
          reason: "Test leave",
          buddyId: buddy.User_ID,
          isEmergency: false,
          filedBy: doer.User_ID,
        });
        expect(leave.status).toBe("Approved");
        expect(leave.activatedAt).not.toBe("");

        // 1. Both of the doer's open tasks reassigned to the buddy the moment the leave activated.
        const afterActivate = await listTasks();
        const t1AfterActivate = afterActivate.find((t) => t.Task_ID === taskCompletedByBuddy.Task_ID);
        const t2AfterActivate = afterActivate.find((t) => t.Task_ID === taskStillPending.Task_ID);
        expect(t1AfterActivate?.Assigned_To).toBe(buddy.User_ID);
        expect(t2AfterActivate?.Assigned_To).toBe(buddy.User_ID);

        // The buddy finishes one of the two during the leave.
        await markTaskDone(taskCompletedByBuddy.Task_ID, "", buddy.User_ID);

        // Ending the leave must not touch the one the buddy already finished, but must
        // hand back the one that's still sitting Pending with the buddy.
        await cancelLeave(leave.id, doer.User_ID, false);

        const afterRevert = await listTasks();
        const t1AfterRevert = afterRevert.find((t) => t.Task_ID === taskCompletedByBuddy.Task_ID);
        const t2AfterRevert = afterRevert.find((t) => t.Task_ID === taskStillPending.Task_ID);

        return { t1AfterRevert, t2AfterRevert, doerId: doer.User_ID, buddyId: buddy.User_ID };
      });

      // 2. Buddy-completed work stays completed, under the buddy's name — never un-completed
      // or reassigned back just because the leave ended.
      expect(result.t1AfterRevert?.Status).toMatch(/^(Done on Time|Delay Done)$/);
      expect(result.t1AfterRevert?.Assigned_To).toBe(result.buddyId);

      // 3. The still-Pending task DOES revert back to the original doer.
      expect(result.t2AfterRevert?.Status).toBe("Pending");
      expect(result.t2AfterRevert?.Assigned_To).toBe(result.doerId);
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });

  /**
   * The gap CLAUDE.md's "Not done yet" list used to call out: a Pending FMS run
   * reassigned to a buddy kept the deadline computed against the *original* doer's
   * working calendar. Fixed via src/lib/fms/engine.ts's recomputeRunTat(), called from
   * both activateLeave() and revertLeave() — this exercises it through the real leave
   * flow rather than calling recomputeRunTat() directly.
   */
  it("recomputes an FMS run's TAT window against the new assignee when leave reassigns and reverts it", async () => {
    const org = await makeTestOrg("LeaveFmsTat");
    let templateId = "";

    try {
      const result = await runWithTenant({ orgId: org.id, org }, async () => {
        const doer = await createUser({
          fullName: "FMS Leave Doer",
          email: `fms-leave-doer-${org.id}@example.com`,
          password: "Password123!",
          role: "Staff",
          department: "Ops",
          phoneNumber: "9990000001",
          createdBy: "SYSTEM",
        });
        const buddy = await createUser({
          fullName: "FMS Leave Buddy",
          email: `fms-leave-buddy-${org.id}@example.com`,
          password: "Password123!",
          role: "Staff",
          department: "Ops",
          phoneNumber: "9990000002",
          createdBy: "SYSTEM",
        });

        templateId = await createFmsTemplate({
          templateName: "Leave TAT Recompute Test Flow",
          triggerEvent: "MANUAL",
          createdBy: "SYSTEM",
          steps: [
            {
              stepNo: 1,
              stepName: "Only Step",
              assignedTo: doer.User_ID,
              tatValue: 4,
              tatUnit: "Hours",
              outcomeOptions: ["Done"],
              nextStepMap: { Done: "END" },
              dataSourceConfig: "",
              actionType: "",
              actionConfig: "",
              outcomeType: "",
              tatSourceStepNo: "",
              tatSourceFieldKey: "",
              tatOffset: 0,
              notifyOnComplete: [],
            },
          ],
        });

        const run = await startFmsInstance({
          templateId,
          contextRef: "TEST:manual",
          startedBy: "SYSTEM",
        });
        const [beforeLeave] = await db.select().from(fmsRuns).where(eq(fmsRuns.id, run.Run_ID));

        await new Promise((resolve) => setTimeout(resolve, 1100));

        const today = todayIST();
        const leave = await createLeave({
          doerId: doer.User_ID,
          leaveType: "Casual",
          startDate: today,
          endDate: today,
          reason: "Test leave",
          buddyId: buddy.User_ID,
          isEmergency: false,
          filedBy: doer.User_ID,
        });
        expect(leave.activatedAt).not.toBe("");

        const [afterActivate] = await db.select().from(fmsRuns).where(eq(fmsRuns.id, run.Run_ID));

        await new Promise((resolve) => setTimeout(resolve, 1100));
        await cancelLeave(leave.id, doer.User_ID, false);

        const [afterRevert] = await db.select().from(fmsRuns).where(eq(fmsRuns.id, run.Run_ID));

        return { runId: run.Run_ID, doerId: doer.User_ID, buddyId: buddy.User_ID, beforeLeave, afterActivate, afterRevert };
      });

      // Reassigning to the buddy recomputes tatStart forward from the moment of
      // reassignment (not left as the original doer's already-computed start).
      expect(result.afterActivate.assignedTo).toBe(result.buddyId);
      expect(result.afterActivate.tatStart!.getTime()).toBeGreaterThan(
        result.beforeLeave.tatStart!.getTime()
      );

      // Reverting back to the original doer recomputes it again, forward from revert time.
      expect(result.afterRevert.assignedTo).toBe(result.doerId);
      expect(result.afterRevert.tatStart!.getTime()).toBeGreaterThan(
        result.afterActivate.tatStart!.getTime()
      );
    } finally {
      if (templateId) {
        await runWithTenant({ orgId: org.id, org }, () =>
          deleteFmsTemplate(templateId).catch(() => {})
        );
      }
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });
});
