import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn(), tenant: vi.fn() }));
vi.mock("@/db/client", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return { db: drizzle(async (sql, params) => m.query(sql, params)) };
});
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: m.tenant }));
import { readPerf04ReportRows } from "@/lib/perf04-report-queries";
import { resolveRange, inRange } from "@/lib/analytics";
import { scopeRows, getReport } from "@/lib/reports";
const viewer = { userId: "USER-1", email: "Person@Example.test", role: "Admin", access: ["LEAD_FMS"] };
beforeEach(() => { vi.resetAllMocks(); m.tenant.mockResolvedValue("ORG-reports"); m.query.mockResolvedValue({ rows: [] }); });
it("pushes date and normalized id/email ownership into a single thin tenant SQL query", async () => {
  await readPerf04ReportRows("leads", resolveRange("custom", "2026-10-01", "2026-10-02"), "mine", viewer);
  expect(m.query).toHaveBeenCalledTimes(1);
  const [sql, params] = m.query.mock.calls[0];
  expect(sql).toMatch(/where.*org_id.*created_at.*>=.*created_at.*<=/);
  expect(sql).toContain("lower(btrim("); expect(sql).toContain('"assigned_to"'); expect(sql).toContain('"created_by"');
  expect(sql).not.toMatch(/phone|email|message|next_follow_up/);
  expect(params).toContain("ORG-reports"); expect(params).toContain("person@example.test"); expect(params).toContain("user-1");
  expect(params).toContain("2026-09-30T18:30:00.000Z"); expect(params).toContain("2026-10-02T18:29:59.999Z");
});
it("SQL projection preserves existing in-range scoped chart inputs including IST boundaries", async () => {
  const range = resolveRange("custom", "2026-10-01", "2026-10-02");
  const raw = [
    { createdAt: "2026-09-30T18:30:00.000Z", status: "New", assignedTo: " USER-1 ", createdBy: "other" },
    { createdAt: "2026-10-02T18:29:59.999Z", status: "Lost", assignedTo: "other", createdBy: "person@example.test" },
    { createdAt: "2026-10-02T18:30:00.000Z", status: "New", assignedTo: "USER-1", createdBy: "" },
    { createdAt: "2026-10-01T00:00:00.000Z", status: "New", assignedTo: "other", createdBy: "" },
  ];
  const expected = scopeRows(raw, getReport("leads")!, "mine", viewer).filter(r => inRange(r.createdAt, range));
  m.query.mockResolvedValue({ rows: expected.map(r => [r.createdAt, r.status, r.assignedTo, r.createdBy]) });
  expect(await readPerf04ReportRows("leads", range, "mine", viewer)).toEqual(expected);
});
it("SQL ownership trims JS-compatible tab and Unicode boundary whitespace", async () => {
  await readPerf04ReportRows("orders", resolveRange("all"), "mine", viewer);
  const params = m.query.mock.calls[0][1] as unknown[];
  expect(params.some(v => typeof v === "string" && v.includes("\t") && v.includes("\u00a0") && v.includes("\ufeff"))).toBe(true);
});
it("empty identities never widen mine scope to all rows", async () => {
  await readPerf04ReportRows("orders", resolveRange("all"), "mine", { ...viewer, userId: "", email: "" });
  expect(m.query.mock.calls[0][0]).toMatch(/false/);
});
it("all scope retains complete chart totals without arbitrary limits", async () => {
  await readPerf04ReportRows("orders", resolveRange("all"), "all", viewer);
  const [sql, params] = m.query.mock.calls[0];
  expect(sql).not.toMatch(/limit|offset|lower\(btrim|>=|<=/); expect(params).toEqual(["ORG-reports"]);
});
