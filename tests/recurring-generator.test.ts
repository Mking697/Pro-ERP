import { describe, expect, it } from "vitest";
import { deleteOrganization, getOrganization } from "@/lib/platform/registry";
import { createUser } from "@/lib/auth/users";
import { runWithTenant } from "@/lib/tenant";
import { createRecurringTask } from "@/lib/recurringTasks";
import { upsertHoliday, deleteHoliday } from "@/lib/holidays";
import { upsertSetting } from "@/lib/settings";
import { generateDueRecurringOccurrences } from "@/lib/recurringGenerator";
import { listTasks } from "@/lib/tasks";
import { todayIST } from "@/lib/dateUtil";
import { makeTestOrg } from "./helpers/testOrg";

function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(dateISO: string): number {
  return new Date(`${dateISO}T00:00:00Z`).getUTCDay();
}

/**
 * generateDueRecurringOccurrences() reads "today" from todayIST() (the real clock) rather
 * than an injectable clock, so these tests don't fake time — instead they make "today"
 * into whatever non-working day they need by pointing this throwaway org's own
 * FMS_WEEKLY_OFF_DAYS / Holiday List settings at it, the same levers a real Admin would
 * configure. That is both simpler and closer to how this code is actually driven in
 * production than mocking Date would be.
 */
describe("recurring generator — Sunday/holiday math", () => {
  it("a Daily rule produces nothing on its own org's weekly-off day", async () => {
    const org = await makeTestOrg("RecurDaily");
    try {
      const created = await runWithTenant({ orgId: org.id, org }, async () => {
        const doer = await createUser({
          fullName: "Recur Doer",
          email: `recur-doer-${org.id}@example.com`,
          password: "Password123!",
          role: "Staff",
          department: "Ops",
          phoneNumber: "9990000003",
          createdBy: "SYSTEM",
        });

        const today = todayIST();
        await upsertSetting("FMS_WEEKLY_OFF_DAYS", String(weekdayOf(today)));

        const rule = await createRecurringTask({
          task: "Daily skip test",
          doerId: doer.User_ID,
          assignedBy: doer.User_ID,
          frequency: "D",
          assignDate: addDaysISO(today, -10),
        });

        const result = await generateDueRecurringOccurrences();
        expect(result.skippedNonWorkingDay).toBeGreaterThan(0);

        const tasks = await listTasks();
        return tasks.some((t) => t.Recurring_ID === rule.Recurring_ID);
      });

      expect(created).toBe(false);
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });

  it("a Daily rule produces nothing on an explicit Holiday List date", async () => {
    const org = await makeTestOrg("RecurHoliday");
    try {
      const created = await runWithTenant({ orgId: org.id, org }, async () => {
        const doer = await createUser({
          fullName: "Recur Doer",
          email: `recur-doer2-${org.id}@example.com`,
          password: "Password123!",
          role: "Staff",
          department: "Ops",
          phoneNumber: "9990000004",
          createdBy: "SYSTEM",
        });

        const today = todayIST();
        // Weekly-off pinned somewhere other than today, so the holiday is the only reason
        // today is non-working — isolates what this test is actually meant to prove.
        await upsertSetting("FMS_WEEKLY_OFF_DAYS", String((weekdayOf(today) + 3) % 7));
        await upsertHoliday(today, "Test Holiday");

        const rule = await createRecurringTask({
          task: "Holiday skip test",
          doerId: doer.User_ID,
          assignedBy: doer.User_ID,
          frequency: "D",
          assignDate: addDaysISO(today, -10),
        });

        const result = await generateDueRecurringOccurrences();
        expect(result.skippedNonWorkingDay).toBeGreaterThan(0);

        const tasks = await listTasks();
        const found = tasks.some((t) => t.Recurring_ID === rule.Recurring_ID);
        await deleteHoliday(today);
        return found;
      });

      expect(created).toBe(false);
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });

  it("a Weekly rule whose natural day was non-working carries forward to the next working day", async () => {
    const org = await makeTestOrg("RecurWeekly");
    try {
      const dueOnCorrectDay = await runWithTenant({ orgId: org.id, org }, async () => {
        const doer = await createUser({
          fullName: "Recur Doer",
          email: `recur-doer3-${org.id}@example.com`,
          password: "Password123!",
          role: "Staff",
          department: "Ops",
          phoneNumber: "9990000005",
          createdBy: "SYSTEM",
        });

        const today = todayIST();
        const yesterday = addDaysISO(today, -1);
        // Yesterday's weekday (never today's, since consecutive days always differ) is the
        // org's weekly-off — so the rule's natural scheduled day (exactly 7 days before
        // "today", i.e. yesterday's own weekday cycle) fell on a non-working day, and today
        // itself is a working day the carry-forward can land the missed cycle on.
        await upsertSetting("FMS_WEEKLY_OFF_DAYS", String(weekdayOf(yesterday)));

        const rule = await createRecurringTask({
          task: "Weekly carry-forward test",
          doerId: doer.User_ID,
          assignedBy: doer.User_ID,
          frequency: "W",
          assignDate: yesterday,
        });

        const result = await generateDueRecurringOccurrences();
        expect(result.created).toBe(1);
        expect(result.skippedNonWorkingDay).toBe(0);

        const tasks = await listTasks();
        const generated = tasks.find((t) => t.Recurring_ID === rule.Recurring_ID);
        return generated?.Due_Date.startsWith(today) ?? false;
      });

      expect(dueOnCorrectDay).toBe(true);
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });
});
