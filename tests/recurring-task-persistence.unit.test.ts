import { beforeEach, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "org" }));
vi.mock("@/db/repo", () => ({
  listByOrg: async () => h.rows,
  insertRecord: async (_table: unknown, values: Record<string, unknown>) => {
    const row = { createdAt: new Date(), completedAt: null, naturalCycleStartDate: null, ...values };
    h.rows.push(row);
    return row;
  },
}));
import { createRecurringOccurrence, createTask, listTasks } from "@/lib/tasks";
beforeEach(() => { h.rows = []; });
const occurrence = {
  recurringId: "RCR-1", title: "Weekly", assignedTo: "doer", assignedBy: "manager",
  frequency: "W", dueDate: "2026-10-06T23:59", naturalCycleStartDate: "2026-10-05",
};
it("keeps unknown legacy identities blank in the DTO without inventing dates from due_date", async () => {
  await createRecurringOccurrence(occurrence);
  h.rows[0].naturalCycleStartDate = null;
  h.rows.push({ ...h.rows[0], id: "historical-second", dueDate: new Date("2026-10-07T18:29:00Z") });
  const records = await listTasks();
  expect(records.map((record) => record.Natural_Cycle_Start_Date)).toEqual(["", ""]);
  expect(h.rows.map((row) => row.naturalCycleStartDate)).toEqual([null, null]);
});
it("persists and reads the carried-forward natural day, not the later due day", async () => {
  const created = await createRecurringOccurrence(occurrence);
  expect(h.rows[0].naturalCycleStartDate).toBe("2026-10-05");
  expect(created.Natural_Cycle_Start_Date).toBe("2026-10-05");
  expect((await listTasks())[0].Due_Date).toBe("2026-10-06T23:59");
});
it("one-off inserts and reads retain an unknown cycle identity", async () => {
  const task = await createTask({ title: "One off", description: "", assignedTo: "doer", assignedBy: "manager", priority: "Medium", dueDate: "2026-10-06T23:59", attachmentUrl: "", remark: "" });
  expect(h.rows[0].recurringId).toBe("");
  expect(h.rows[0].naturalCycleStartDate).toBeNull();
  expect(task.Natural_Cycle_Start_Date).toBe("");
});
