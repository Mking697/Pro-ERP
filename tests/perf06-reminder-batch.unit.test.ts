import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ tasks: vi.fn(), users: vi.fn(), runs: vi.fn(), batch: vi.fn(), single: vi.fn() }));
vi.mock("@/lib/tasks", () => ({ listTasks: m.tasks }));
vi.mock("@/lib/auth/users", () => ({ listUsers: m.users }));
vi.mock("@/lib/fms/engine", () => ({ listAllFmsRuns: m.runs }));
vi.mock("@/lib/chatxflow", () => ({ sendWhatsAppBatch: m.batch, sendWhatsAppMessage: m.single }));
vi.mock("@/db/client", () => { throw Error("DB forbidden"); });
import { resolveRange } from "@/lib/analytics";
import { sendPendingTaskReminders, sendPerformanceReports } from "@/lib/reminders";
beforeEach(() => {
  vi.resetAllMocks();
  m.users.mockResolvedValue([
    { User_ID: "a", Full_Name: "A", Status: "Active", Phone_Number: "123" },
    { User_ID: "b", Full_Name: "B", Status: "Inactive", Phone_Number: "456" },
    { User_ID: "c", Full_Name: "C", Status: "Active", Phone_Number: "" },
  ]);
  m.tasks.mockResolvedValue([{ Assigned_To: "a", Status: "Pending", Title: "A-only", Due_Date: "2020-01-01", Created_At: "2020-01-01" }]);
  m.runs.mockResolvedValue([]); m.batch.mockResolvedValue({ sent: 1, failed: 0 }); m.single.mockResolvedValue({ ok: true });
});
it("pending reminders call the safe batch once and keep inactive/missing-phone users out", async () => {
  expect(await sendPendingTaskReminders()).toEqual({ sent: 1, failed: 0 });
  expect(m.batch).toHaveBeenCalledTimes(1); expect(m.single).not.toHaveBeenCalled();
  expect(m.batch.mock.calls[0][0]).toEqual([{ phone: "123", message: expect.stringContaining("A-only") }]);
  expect(m.tasks).toHaveBeenCalledTimes(1); expect(m.users).toHaveBeenCalledTimes(1);
});
it("performance reports retain recipient-only breakdown and skipped accounting", async () => {
  const range = resolveRange("all");
  expect(await sendPerformanceReports(range)).toEqual({ sent: 1, failed: 0, skipped: 1 });
  expect(m.batch).toHaveBeenCalledTimes(1); expect(m.single).not.toHaveBeenCalled();
  expect(m.batch.mock.calls[0][0]).toHaveLength(1);
  expect(m.tasks).toHaveBeenCalledTimes(1); expect(m.runs).toHaveBeenCalledTimes(1); expect(m.users).toHaveBeenCalledTimes(1);
});
