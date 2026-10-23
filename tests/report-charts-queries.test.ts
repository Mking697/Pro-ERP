import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/db/client", async () => { const { drizzle } = await import("drizzle-orm/pg-proxy"); return { db: drizzle(async (sql, params) => m.query(sql, params)) }; });
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "ORG-report" }));
import { readPerf04ReportRows } from "@/lib/perf04-report-queries";
import { resolveRange } from "@/lib/analytics";
const viewer = { userId: "USER", email: "user@example.test", role: "Admin", access: [] };
beforeEach(() => { vi.resetAllMocks(); m.query.mockResolvedValue({ rows: [] }); });
it("maintenance selects recorded working downtime with tenant/date/owner predicates, never descriptions", async () => {
  await readPerf04ReportRows("maintenance", resolveRange("month"), "mine", viewer);
  const [sql, params] = m.query.mock.calls[0];
  expect(sql).toContain('"working_minutes_lost"'); expect(sql).toContain('"reported_at"');
  expect(sql).toContain('"reported_by"'); expect(sql).toContain('"assigned_to"'); expect(sql).toContain("lower(btrim(");
  expect(sql).not.toMatch(/description|fixed_remark|limit/); expect(params).toContain("ORG-report");
});
it.each([ ["orders", "order_value"], ["invoices", "final_value"], ["bills", "amount"] ] as const)("%s transfers real monetary input without payment/outstanding inference", async (kind, column) => {
  await readPerf04ReportRows(kind, resolveRange("all"), "all", viewer);
  expect(m.query.mock.calls[0][0]).toContain(`"${column}"`);
});
it.each(["ims", "failures"] as const)("%s resolves UOM only through same-tenant inward and item links", async kind => {
  await readPerf04ReportRows(kind, resolveRange("all"), "mine", viewer);
  const [sql] = m.query.mock.calls[0];
  expect(sql).toContain("linked_entry_id"); expect(sql).toContain("items"); expect(sql).toContain("uom");
  expect(sql.match(/org_id/g)!.length).toBeGreaterThanOrEqual(5);
});
it("PPC has plan quantities/product identity but never treats start actual_qty as output", async () => {
  await readPerf04ReportRows("ppc", resolveRange("all"), "all", viewer);
  const [sql] = m.query.mock.calls[0]; expect(sql).toContain("planned_qty"); expect(sql).toContain("product_sku"); expect(sql).not.toContain("actual_qty");
});

it("maintenance all scope retains tenant/date predicates without an owner restriction", async () => {
  await readPerf04ReportRows("maintenance", resolveRange("month"), "all", viewer);
  const [sql, params] = m.query.mock.calls[0]; expect(sql).toMatch(/where.*org_id.*reported_at.*>=.*reported_at.*<=/);
  expect(sql).not.toContain("lower(btrim("); expect(params).toContain("ORG-report");
});

it("PPC recorded output comes only from plan-linked product receipts; FMS lineage and incompatible units stay unavailable", async () => {
  await readPerf04ReportRows("ppc", resolveRange("all"), "all", viewer);
  const [sql, params] = m.query.mock.calls[0];
  expect(sql).toContain("stock_ledger"); expect(sql).toContain("reference_id"); expect(sql).toContain("context_ref");
  expect(sql).toContain("sum("); expect(sql).toContain("then null");
  expect(params).toContain("Production_Output"); expect(params).toContain("In"); expect(sql).not.toContain("actual_qty");
});

it.each(["ims", "failures"] as const)("%s scalar lookup keeps every tenant correlation qualified under Drizzle single-table selection", async kind => {
  await readPerf04ReportRows(kind, resolveRange("all"), "all", viewer);
  const [sql] = m.query.mock.calls[0]; const outer = kind === "ims" ? "ims_inward" : "failure_log";
  expect(sql).toContain('"items"."org_id" = "inward_iqc_fms"."org_id"');
  expect(sql).toContain(`"inward_iqc_fms"."org_id" = "${outer}"."org_id"`);
  expect(sql).toContain(`"inward_iqc_fms"."id" = "${outer}"."linked_entry_id"`);
  expect(sql).not.toContain('"org_id" = "org_id"');
});
