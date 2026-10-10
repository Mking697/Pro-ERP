import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), tenant: vi.fn() }));
vi.mock("@/db/client", async () => { const { drizzle } = await import("drizzle-orm/pg-proxy"); return { db: drizzle(async (sql, params) => m.query(sql, params)) }; });
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: m.tenant }));
vi.mock("@/lib/fms/engine", () => ({ isFmsStepOverdue: (r: {Status: string; TAT_Deadline: string}) => r.Status === "Pending" && !!r.TAT_Deadline && new Date(r.TAT_Deadline) < new Date() }));
import { readPerf04Performance, readPerf04TaskInputs } from "@/lib/perf04-report-queries";
import { resolveRange } from "@/lib/analytics";
import { computeCombinedMisSummary } from "@/lib/mis";
import type { TaskRecord } from "@/lib/tasks";
import type { FmsRunRecord } from "@/lib/fms/engine";
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-10T00:00:00Z")); m.tenant.mockResolvedValue("ORG-score"); m.query.mockResolvedValue({ rows: [] }); });
afterEach(() => vi.useRealTimers());
it("performance uses SQL aggregates, stable SQL user pagination, bounded per-user details in four queries", async () => {
  m.query.mockImplementation(async (sql: string) => sql.includes('from "users"') ? { rows: [["u", "Name", "Employee", "D", 2, 3, 4]] } : { rows: [] });
  const value = await readPerf04Performance(resolveRange("month"), 2);
  expect(value.rows).toHaveLength(1); expect(m.query).toHaveBeenCalledTimes(4);
  const pageCall = m.query.mock.calls.find(([sql]) => sql.includes('from "users"') && sql.includes("limit"))!;
  expect(pageCall[0]).toMatch(/order by.*case.*users.*id.*limit.*offset/); expect(pageCall[1]).toContain(26); expect(pageCall[1]).toContain(50);
  for (const [sql, params] of m.query.mock.calls) {
    expect(params).toContain("ORG-score"); expect(sql).not.toMatch(/form_data|password_hash|attachment_url/);
    if (sql.includes("row_number")) { expect(sql).toMatch(/partition by.*assigned_to.*order by.*created_at.*id/); expect(params).toContain(20); }
  }
});
it("complete aggregate scores retain task counters, overdue strictness and paused FMS exclusion", async () => {
  const tasks = [
    { On_Time_Count: "2", Delay_Count: "1", Status: "Completed", Due_Date: "" },
    { On_Time_Count: "0", Delay_Count: "0", Status: "Pending", Due_Date: "2026-10-09T00:00:00Z" },
    { On_Time_Count: "0", Delay_Count: "0", Status: "Pending", Due_Date: "2026-10-10T00:00:00Z" },
  ] as TaskRecord[];
  const runs = [ { Status: "On Time" }, { Status: "Delay Done" }, { Status: "Pending", TAT_Deadline: "2026-10-09T00:00:00Z" }, { Status: "Paused", TAT_Deadline: "2026-10-09T00:00:00Z" } ] as FmsRunRecord[];
  const expected = computeCombinedMisSummary(tasks, runs);
  m.query.mockImplementation(async (sql: string) => sql.includes('from "users"') ? { rows: [["u", "Name", "Employee", "", 3, 2, 2]] } : { rows: [] });
  expect((await readPerf04Performance(resolveRange("all"), 0)).rows[0].summary).toEqual(expected);
  const sql = m.query.mock.calls[0][0];
  expect(sql).toContain("sum("); expect(sql).toContain("'Pending'"); expect(sql).toContain("<"); expect(sql).not.toContain("'Paused'");
});
it("my/delegated task chart reads push range and ownership into SQL", async () => {
  await readPerf04TaskInputs(resolveRange("month"), "user", true);
  expect(m.query).toHaveBeenCalledTimes(1);
  const [sql, params] = m.query.mock.calls[0]; expect(sql).toMatch(/assigned_to.*or.*assigned_by/); expect(sql).toMatch(/created_at.*>=/); expect(params).toContain("ORG-score");
});
