import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/db/client", async () => { const { drizzle } = await import("drizzle-orm/pg-proxy"); return { db: drizzle(async (sql, params) => m.query(sql, params)) }; });
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "ORG-other" }));
vi.mock("@/lib/fms/engine", () => ({ isFmsStepOverdue: vi.fn() }));
import { readPerf04Payroll, readPerf04Boms, readPerf04Recurring } from "@/lib/perf04-report-queries";
import { resolveRange } from "@/lib/analytics";
const viewer = { userId: "USER", email: "user@example.test", role: "Admin", access: [] };
beforeEach(() => { vi.resetAllMocks(); m.query.mockResolvedValue({ rows: [] }); });
it("payroll joins finalized tenant-owned runs, filters history before LIMIT 12, keeps overall latest separately", async () => {
  await readPerf04Payroll(resolveRange("month"), "USER");
  expect(m.query).toHaveBeenCalledTimes(2);
  const limits = [];
  for (const [sql, params] of m.query.mock.calls) {
    expect(sql).toContain('"payslips"."org_id"'); expect(sql).toContain('"payroll_runs"."org_id"');
    expect(params).toContain("Finalized"); expect(params).toContain("USER"); expect(params).toContain("ORG-other");
    expect(sql).not.toMatch(/monthly_salary|pdf_url|pf_employee/); expect(sql).toMatch(/order by.*month.*id.*limit/); limits.push(params.at(-1));
  }
  expect(limits).toEqual([12, 1]); expect(m.query.mock.calls[0][0]).toMatch(/created_at.*>=/); expect(m.query.mock.calls[1][0]).not.toMatch(/>=|<=/);
});
it("BOM transfers grouped counts plus only the ten latest active products, no component details", async () => {
  await readPerf04Boms("mine", viewer);
  expect(m.query).toHaveBeenCalledTimes(2);
  expect(m.query.mock.calls[0][0]).toMatch(/count\(distinct.*bom_id.*group by/);
  expect(m.query.mock.calls[1][0]).toMatch(/count\(\*\).*group by.*order by.*limit/); expect(m.query.mock.calls[1][1]).toContain(10);
  for (const [sql, params] of m.query.mock.calls) { expect(sql).not.toMatch(/select.*"component_sku",|qty_per_unit/); expect(sql).toContain("lower(btrim("); expect(params).toContain("ORG-other"); }
});
it("BOM line counts ignore blank component rows just like groupBoms", async () => {
  await readPerf04Boms("all", viewer);
  expect(m.query.mock.calls[1][0]).toMatch(/count\(\*\) filter \(where.*component_sku.*<> ''\)/);
});
it("recurring status/frequency are SQL aggregates rather than full descriptions", async () => {
  await readPerf04Recurring("mine", viewer);
  expect(m.query).toHaveBeenCalledTimes(2);
  for (const [sql, params] of m.query.mock.calls) { expect(sql).toMatch(/count\(\*\).*group by/); expect(sql).not.toMatch(/"task"|"doer_id"/); expect(sql).toContain('"assigned_by"'); expect(params).toContain("ORG-other"); }
});
