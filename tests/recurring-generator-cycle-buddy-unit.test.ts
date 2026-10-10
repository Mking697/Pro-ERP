/* eslint-disable @typescript-eslint/no-explicit-any -- Minimal in-memory persistence/mocking fixture; application code remains fully typed. */
import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  rules: [] as any[],
  holidays: new Set<string>(),
  existingTasks: [] as any[],
  weeklyOffSetting: "0",
  today: "2026-10-09",
  created: [] as any[],
  assigneeOverrides: {} as Record<string, string>,
  failNextInsertsOnDueDate: new Set<string>(),
  leaveIdOverrides: {} as Record<string, string>,
  auditRows: [] as any[],
}));

vi.mock("@/lib/recurringTasks", () => ({ listActiveRecurringTasks: async () => h.rules }));
vi.mock("@/lib/holidays", () => ({ getHolidayDates: async () => h.holidays }));
vi.mock("@/lib/dateUtil", () => ({ todayIST: () => h.today }));
vi.mock("@/lib/settings", () => ({ getSetting: async () => h.weeklyOffSetting }));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "org" }));
// resolveActiveAssigneeWithAudit is the exact primitive OPS-01 adds in
// src/lib/leave/reassignment.ts for buddy-at-creation-time resolution plus its
// leave_reassignments audit row — mocked here as a simple lookup table so this file tests
// only generateDueRecurringOccurrences' own orchestration of it, not its (separately,
// DB-free unit-tested in tests/leave-reassignment-atomicity-unit.test.ts) internal
// leave-table logic.
vi.mock("@/lib/leave/reassignment", () => ({
  resolveActiveAssigneeWithAudit: async (_orgId: string, userId: string) => ({
    assignedTo: h.assigneeOverrides[userId] ?? userId,
    leaveId: h.leaveIdOverrides[userId] ?? "",
  }),
}));
vi.mock("@/db/client", () => ({
  runInTenantTransaction: async (_orgId: string, work: () => Promise<unknown>) => work(),
}));
vi.mock("@/db/schema", () => ({ leaveReassignments: {} }));
vi.mock("@/lib/id", () => ({ generateId: (prefix: string) => `${prefix}-${h.auditRows.length + 1}` }));
vi.mock("@/db/repo", () => ({
  insertRecord: async (_table: unknown, values: any) => {
    h.auditRows.push(values);
    return values;
  },
}));
vi.mock("@/lib/tasks", () => ({
  listTasks: async () => h.existingTasks,
  createRecurringOccurrence: async (input: any) => {
    // Mirrors the real DB's tasks_org_id_recurring_id_due_date_unique partial unique
    // index: this mock's own "already generated for this cycle" state is seeded by the
    // test via h.failNextInsertsOnDueDate, simulating a concurrent/retried call whose
    // insert lands after another one already committed for the same (recurringId, dueDate).
    const cycleKey = `${input.recurringId}:${input.dueDate}`;
    if (h.failNextInsertsOnDueDate.has(cycleKey)) {
      const err: any = new Error(
        'duplicate key value violates unique constraint "tasks_org_id_recurring_id_due_date_unique"'
      );
      err.code = "23505";
      err.constraint = "tasks_org_id_recurring_id_due_date_unique";
      throw err;
    }
    if (h.created.some((row) => row.recurringId === input.recurringId && row.naturalCycleStartDate === input.naturalCycleStartDate)) {
      throw Object.assign(new Error("wrapped insert failure"), { cause: {
        code: "23505", constraint: "tasks_org_id_recurring_id_natural_cycle_unique",
      } });
    }
    h.created.push(input);
    return { Task_ID: `TSK-${h.created.length}`, ...input };
  },
}));

import { generateDueRecurringOccurrences } from "@/lib/recurringGenerator";

beforeEach(() => {
  h.rules = [];
  h.holidays = new Set();
  h.existingTasks = [];
  h.weeklyOffSetting = "0";
  h.today = "2026-10-09"; // a Friday — never itself the default Sunday weekly-off
  h.created = [];
  h.assigneeOverrides = {};
  h.failNextInsertsOnDueDate = new Set();
  h.leaveIdOverrides = {};
  h.auditRows = [];
});

function dailyRule(overrides: Partial<Record<string, string>> = {}) {
  return {
    Recurring_ID: "RCR-1",
    Task: "Daily check",
    Doer_ID: "doer",
    Assigned_By: "manager",
    Frequency: "D",
    Assign_Date: "2026-01-01",
    Status: "Active",
    Created_At: "",
    ...overrides,
  };
}

// RED (buddy-resolution-at-creation-time): pre-fix, the generator assigned
// `rule.Doer_ID` verbatim with no leave awareness at all — this is the behavior this
// item adds. Asserting against the live import proves the generator now actually calls
// through to leave resolution, not just that the mock exists.
it("assigns a newly generated occurrence to the doer's active-leave buddy, not the absent doer", async () => {
  h.rules = [dailyRule()];
  h.assigneeOverrides = { doer: "buddy" };

  const result = await generateDueRecurringOccurrences();

  expect(result.created).toBe(1);
  expect(h.created).toHaveLength(1);
  expect(h.created[0].assignedTo).toBe("buddy");
});

it("assigns to the doer unchanged when nobody is on leave", async () => {
  h.rules = [dailyRule()];

  await generateDueRecurringOccurrences();

  expect(h.created[0].assignedTo).toBe("doer");
});

// RED (atomic audit for buddy-born work): a recurring occurrence created while its doer
// is mid-leave must record a leave_reassignments audit row in the SAME transaction as the
// Task insert — so revertLeave() can find and hand it back later, exactly like Task/FMS
// entities that existed at activation time. Pre-fix, nothing recorded this at all: the
// buddy got the occurrence with no audit trail, and revertLeave() could never find it.
it("records a leave_reassignments audit row for an occurrence born on the buddy", async () => {
  h.rules = [dailyRule()];
  h.assigneeOverrides = { doer: "buddy" };
  h.leaveIdOverrides = { doer: "LV-1" };

  await generateDueRecurringOccurrences();

  expect(h.auditRows).toHaveLength(1);
  expect(h.auditRows[0]).toMatchObject({
    leaveId: "LV-1",
    entityType: "TASK",
    entityId: "TSK-1",
    originalAssignee: "doer",
    buddyId: "buddy",
  });
});

it("records no audit row when nobody is on leave", async () => {
  h.rules = [dailyRule()];

  await generateDueRecurringOccurrences();

  expect(h.auditRows).toHaveLength(0);
});

// RED (durable natural-cycle identity / concurrent-retry safety): pre-fix, the generator
// had only an in-memory "already generated" read, which two concurrent/retried calls can
// both pass before either inserts — nothing stopped a real duplicate row. This proves the
// generator now treats the DB's own unique-violation as an idempotent no-op rather than
// crashing the whole cron run or double-counting `created`.
it("treats a concurrent/retried cron run's duplicate-cycle insert as already-generated, not an error", async () => {
  h.rules = [dailyRule()];
  // Simulates another, concurrent invocation of this same job having already committed
  // this exact rule's occurrence for today, after this call's own in-memory
  // `existingTasks` snapshot was read (hence it's not already in h.existingTasks either).
  h.failNextInsertsOnDueDate.add("RCR-1:2026-10-09T23:59");

  const result = await generateDueRecurringOccurrences();

  expect(result.created).toBe(0);
  expect(result.duplicatesSkipped).toBe(1);
  expect(h.created).toHaveLength(0);
});

it("recognizes a persisted natural cycle even when its due date differs", async () => {
  h.today = "2026-10-07";
  h.rules = [dailyRule({ Frequency: "W", Assign_Date: "2026-10-05" })];
  h.existingTasks = [{ Recurring_ID: "RCR-1", Due_Date: "2026-10-04T23:59", Natural_Cycle_Start_Date: "2026-10-05" }];
  expect((await generateDueRecurringOccurrences()).created).toBe(0);
  expect(h.created).toHaveLength(0);
});

it("does not confuse a known previous cycle's later due date with this cycle", async () => {
  h.today = "2026-10-07";
  h.rules = [dailyRule({ Frequency: "W", Assign_Date: "2026-10-05" })];
  h.existingTasks = [{ Recurring_ID: "RCR-1", Due_Date: "2026-10-06T23:59", Natural_Cycle_Start_Date: "2026-09-28" }];
  expect((await generateDueRecurringOccurrences()).created).toBe(1);
  expect(h.created[0]).toMatchObject({ naturalCycleStartDate: "2026-10-05", dueDate: "2026-10-07T23:59" });
});

it("a genuine insert failure unrelated to the cycle constraint still propagates", async () => {
  h.rules = [dailyRule()];
  // Re-mocking createRecurringOccurrence for just this test to throw a different error.
  const tasksModule = await import("@/lib/tasks");
  const spy = vi
    .spyOn(tasksModule, "createRecurringOccurrence")
    .mockRejectedValueOnce(new Error("connection reset"));

  await expect(generateDueRecurringOccurrences()).rejects.toThrow("connection reset");
  spy.mockRestore();
});

it("skips a carried-forward cycle retried on a later day with a stale read and wrapped natural-key collision", async () => {
  h.rules = [dailyRule({ Frequency: "W", Assign_Date: "2026-10-05" })];
  h.holidays.add("2026-10-05");
  h.assigneeOverrides = { doer: "buddy" };
  h.leaveIdOverrides = { doer: "LV-1" };
  h.today = "2026-10-06";
  expect((await generateDueRecurringOccurrences()).created).toBe(1);
  h.today = "2026-10-07";
  const retried = await generateDueRecurringOccurrences();
  expect(retried).toMatchObject({ created: 0, duplicatesSkipped: 1 });
  expect(h.created).toHaveLength(1);
  expect(h.created[0]).toMatchObject({ naturalCycleStartDate: "2026-10-05", dueDate: "2026-10-06T23:59" });
  expect(h.auditRows).toHaveLength(1);
});

it("retains the conservative legacy due-date skip without fabricating a historical cycle key", async () => {
  h.today = "2026-10-07";
  h.rules = [dailyRule({ Frequency: "W", Assign_Date: "2026-10-05" })];
  h.existingTasks = [
    { Recurring_ID: "RCR-1", Due_Date: "2026-10-06T23:59", Natural_Cycle_Start_Date: "" },
    { Recurring_ID: "RCR-1", Due_Date: "2026-09-29T23:59", Natural_Cycle_Start_Date: "" },
  ];
  expect((await generateDueRecurringOccurrences()).created).toBe(0);
  expect(h.existingTasks.map((t) => t.Natural_Cycle_Start_Date)).toEqual(["", ""]);
});

it("counts created and duplicatesSkipped independently across multiple rules", async () => {
  h.rules = [
    dailyRule({ Recurring_ID: "RCR-1" }),
    dailyRule({ Recurring_ID: "RCR-2", Doer_ID: "doer2" }),
  ];
  h.failNextInsertsOnDueDate.add("RCR-2:2026-10-09T23:59");

  const result = await generateDueRecurringOccurrences();

  expect(result.created).toBe(1);
  expect(result.duplicatesSkipped).toBe(1);
  expect(h.created.map((c) => c.recurringId)).toEqual(["RCR-1"]);
});
