import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
const m = vi.hoisted(() => ({ read: vi.fn(), task: vi.fn(), recurring: vi.fn(), boms: vi.fn(), payroll: vi.fn(), performance: vi.fn(), stock: vi.fn(), tenant: vi.fn(), aging: vi.fn() }));
vi.mock("@/lib/accounts/accounts", () => ({ getReceivablesAging: m.aging }));
vi.mock("@/lib/perf04-report-queries", () => ({ readPerf04ReportRows: m.read, readPerf04TaskInputs: m.task, readPerf04Recurring: m.recurring, readPerf04Boms: m.boms, readPerf04Payroll: m.payroll, readPerf04Performance: m.performance }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/auth/guard", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/auth/users", () => ({ listUsers: async () => [] }));
vi.mock("@/lib/tenant", () => ({ runWithTenant: m.tenant }));
vi.mock("@/lib/i18n/server", () => ({ getT: async () => (text: string) => text }));
vi.mock("@/lib/fms/engine", () => ({ isFmsStepOverdue: () => false }));
vi.mock("@/lib/inventory/service", () => ({ getInventorySnapshot: m.stock, itemsNeedingReorder: (rows: Array<{ projected: number; rop: number }>) => rows.filter(r => r.projected < r.rop) }));
vi.mock("@/db/client", () => { throw Error("Reports must remain DB-free in this harness"); });
import Analytics from "@/app/dashboard/analytics";
import { REPORTS } from "@/lib/reports";
import type { SessionPayload } from "@/lib/auth/session";
import { EN } from "@/lib/i18n/en";
const viewer = { orgId: "ORG", userId: "USER", email: "me@test.invalid", role: "Admin", access: REPORTS.flatMap(r => r.grants) } as SessionPayload;
const stamp = "2026-10-10T06:00:00Z";
type Node = ReactElement<Record<string, unknown>>;
function nodes(tree: ReactNode): Node[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!React.isValidElement(tree)) return [];
  const el = tree as Node;
  return [el, ...nodes(el.props.children as ReactNode)];
}
const name = (el: Node) => typeof el.type === "function" ? el.type.name : el.type;
async function render(id: string, access = viewer.access) { return Analytics({ session: { ...viewer, access }, rangeKey: "custom", from: "2026-10-01", to: "2026-10-31", only: id, scope: "mine", hideFilter: true, tenant: { orgId: "SHARE" } as never }); }
function charts(tree: ReactNode) { return nodes(tree).filter(el => ["BarChart", "TimelineChart", "SeriesChart"].includes(String(name(el)))); }
beforeEach(() => {
  vi.resetAllMocks(); m.tenant.mockImplementation((_tenant, fn) => fn());
  m.aging.mockResolvedValue({ rows: [], bucketTotals: { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 }, grandTotal: 0 });
  m.read.mockResolvedValue([]); m.task.mockResolvedValue([]);
  m.recurring.mockResolvedValue({ statuses: [], frequencies: [] }); m.boms.mockResolvedValue({ active: [], statuses: [] });
  m.payroll.mockResolvedValue({ history: [], latest: null });
  m.performance.mockResolvedValue({ charts: [], rows: [], tasks: [], fmsRuns: [], page: 0, hasMore: false });
  m.stock.mockResolvedValue({ items: [{ item: { SKU: "FG", Item_Name: "Product", Category: "FG", UOM: "PCS" }, projected: 5, rop: 10, status: "Low", onHand: 5 }] });
});
it.each(REPORTS.map(r => r.id))("%s renders meaningful non-donut charts and never fetches sibling report inputs", async id => {
  const tree = await render(id);
  if (id === "performance") { expect(nodes(tree).some(el => name(el) === "PerformanceSection")).toBe(true); }
  else expect(charts(tree).length).toBeGreaterThanOrEqual(2);
  expect(nodes(tree).some(el => name(el) === "DonutChart")).toBe(false);
  const expected: Record<string, string[]> = { inward: ["inward"], iqc: ["failures", "ims"], ims: ["ims"], indents: ["indents"], ppc: ["ppc"], leave: ["leave"], leads: ["leads"], orders: ["orders"], pdi: ["pdi"], tms: ["tms"], accounts: ["invoices", "bills"], dispatch: ["dispatch"], maintenance: ["maintenance"] };
  expect(m.read.mock.calls.map(c => c[0])).toEqual(expected[id] ?? []);
  expect(m.aging).toHaveBeenCalledTimes(id === "accounts" ? 1 : 0);
  for (const call of m.read.mock.calls) { expect(call[2]).toBe("mine"); expect(call[3]).toEqual(viewer); }
  expect(m.tenant).toHaveBeenCalledTimes(1);
});
it("denied maintenance makes no data read", async () => { const tree = await render("maintenance", []); expect(m.read).not.toHaveBeenCalled(); expect(charts(tree)).toHaveLength(0); });
it("IQC never combines KG and PCS, or silently assigns a unit to an unlinked receipt", async () => {
  m.read.mockImplementation(async kind => kind === "ims" ? [
    { Timestamp: stamp, Pass_Qty: "10", UOM: "KG", Verified_By: "USER" },
    { Timestamp: stamp, Pass_Qty: "7", UOM: "PCS", Verified_By: "USER" },
    { Timestamp: stamp, Pass_Qty: "100", UOM: "", Verified_By: "USER" },
  ] : [{ Timestamp: stamp, Fail_Qty: "2", UOM: "KG", Fail_Reason: "Damage", Verified_By: "USER" }]);
  const tree = await render("iqc"); const cs = charts(tree);
  const kg = cs.find(c => c.props.valueSuffix === " KG"); const pcs = cs.find(c => c.props.valueSuffix === " PCS");
  expect(kg?.props.data).toEqual(expect.arrayContaining([expect.objectContaining({ value: 10 }), expect.objectContaining({ value: 2 })]));
  expect(pcs?.props.data).toEqual(expect.arrayContaining([expect.objectContaining({ value: 7 })]));
  expect(JSON.stringify(tree)).toContain("UOM");
});
it("IMS supplier visual is explicitly an entry count, never accepted quantity", async () => {
  m.read.mockResolvedValue([{ Timestamp: stamp, Pass_Qty: "200", Party_Name: "Vendor", Verified_By: "USER" }]);
  const tree = await render("ims"); expect(charts(tree)[0].props.data).toEqual([expect.objectContaining({ label: "Vendor", value: 1 })]);
  expect(JSON.stringify(tree)).not.toContain("accepted qty");
});
it("reorder compares percent below each own ROP rather than mixing units or rounding tiny shortages away", async () => {
  m.stock.mockResolvedValue({ items: [{ item: { SKU: "A", Item_Name: "A", UOM: "KG" }, projected: 9.999, rop: 10, status: "Low" }, { item: { SKU: "B", Item_Name: "B", UOM: "PCS" }, projected: 5, rop: 20, status: "Critical" }] });
  const data = charts(await render("inventory"))[1].props.data as Array<{ value: number }>;
  expect(data[0].value).toBe(75); expect(data[1].value).toBeCloseTo(0.01); expect(charts(await render("inventory"))[1].props.valueSuffix).toBe("%");
});
it("orders value trend excludes canceled orders and labels INR as booked value, not revenue", async () => {
  m.read.mockResolvedValue([{ createdAt: stamp, status: "Cancelled", orderValue: "999", createdBy: "USER" }, { createdAt: stamp, status: "Delivered", orderValue: "125.50", createdBy: "USER" }]);
  const tree = await render("orders"); const money = charts(tree).find(c => c.props.valueSuffix === " INR");
  expect((money?.props.points as Array<{ value: number }>).reduce((n, p) => n + p.value, 0)).toBe(125.5);
});
it("accounts uses invoice/bill amounts, not record counts or guessed outstanding", async () => {
  m.read.mockImplementation(async kind => [{ createdAt: stamp, status: "Issued", amount: kind === "invoices" ? "1500" : "750" }]);
  const cs = charts(await render("accounts")); expect(cs[0].props.data).toEqual([expect.objectContaining({ value: 1500 })]); expect(cs[1].props.data).toEqual([expect.objectContaining({ value: 750 })]);
});
it("accounts aging forwards only reconciled current all-time aggregates under the share tenant", async () => {
  let activeTenant: unknown;
  m.tenant.mockImplementation(async (tenant, fn) => { activeTenant = tenant; try { return await fn(); } finally { activeTenant = undefined; } });
  let readTenant: unknown;
  let readArgs: unknown[] = [];
  m.aging.mockImplementation(async (...args) => {
    readTenant = activeTenant; readArgs = args;
    return { rows: [{ orderId: "PRIVATE-ORDER", partyName: "PRIVATE-PARTY", outstanding: 999999 }], bucketTotals: { "0-30": 125.5, "31-60": 200, "61-90": 90, "90+": 400 }, grandTotal: 815.5 };
  });
  const tree = await render("accounts");
  expect(readTenant).toEqual({ orgId: "SHARE" }); expect(readArgs).toEqual([]);
  const frame = nodes(tree).find(el => el.props.title === "Current receivables aging (INR)");
  expect(frame).toBeDefined();
  const chart = charts(frame)[0];
  expect(chart.props.data).toEqual([
    { label: "0-30", value: 125.5, color: "var(--chart-series-1)" },
    { label: "31-60", value: 200, color: "var(--chart-series-2)" },
    { label: "61-90", value: 90, color: "var(--chart-series-3)" },
    { label: "90+", value: 400, color: "var(--chart-series-3)" },
  ]);
  expect(chart.props.valueSuffix).toBe(" INR");
  expect(JSON.stringify(frame)).toContain("815.5");
  expect(JSON.stringify(frame)).toContain("Current all-time snapshot");
  expect(JSON.stringify(frame)).toContain("earliest Issued invoice");
  expect(JSON.stringify(frame)).toContain("90+ means more than 90 days");
  expect(JSON.stringify(frame)).not.toMatch(/PRIVATE|999999/);
});
it("accounts aging failure is unavailable, not a zero outstanding balance", async () => {
  m.aging.mockRejectedValue(Error("offline"));
  const tree = await render("accounts");
  expect(JSON.stringify(tree)).toContain("Receivables aging unavailable");
  expect(charts(tree).some(c => (c.props.data as Array<{ label: string }> | undefined)?.some(r => r.label === "90+"))).toBe(false);
  expect(charts(tree)).toHaveLength(2);
});
it("denied accounts never reads reconciled aging", async () => {
  await render("accounts", []); expect(m.aging).not.toHaveBeenCalled();
});
it("an empty reconciled aging snapshot shows no outstanding receivables, not a zero distribution", async () => {
  const frame = nodes(await render("accounts")).find(el => el.props.title === "Current receivables aging (INR)");
  const html = renderToStaticMarkup(frame);
  expect(html).toContain("No current outstanding receivables."); expect(html).not.toContain("<ul");
});
it("current aging remains available even when selected-period billed reads fail", async () => {
  m.read.mockRejectedValue(Error("offline"));
  const tree = await render("accounts");
  expect(JSON.stringify(tree)).toContain("Report data unavailable");
  expect(charts(tree)).toHaveLength(1);
  expect(m.aging).toHaveBeenCalledTimes(1);
});
it("accounts all scope still calls current aging without period or owner filters", async () => {
  await Analytics({ session: viewer, rangeKey: "all", only: "accounts", scope: "all", tenant: { orgId: "SHARE" } as never });
  expect(m.aging).toHaveBeenCalledExactlyOnceWith();
  expect(m.read).toHaveBeenCalledWith("invoices", expect.anything(), "all", viewer);
  expect(m.read).toHaveBeenCalledWith("bills", expect.anything(), "all", viewer);
});
it("maintenance ranks only recorded resolved downtime, never estimates open-request duration", async () => {
  m.read.mockResolvedValue([{ id: "A", createdAt: stamp, status: "Resolved", line: "Line A", workingMinutesLost: "45", reportedBy: "USER" }, { id: "B", createdAt: stamp, status: "Open", workingMinutesLost: null, reportedBy: "USER" }]);
  const cs = charts(await render("maintenance")); expect(cs[0].props.data).toEqual([expect.objectContaining({ value: 45 })]); expect(cs[0].props.valueSuffix).toBe(" min");
});
it("read failure is visible as unavailable rather than zero-valued success", async () => { m.read.mockRejectedValue(Error("offline")); expect(JSON.stringify(await render("leads"))).toContain("unavailable"); });

it.each([
  ["inward", "Is period me koi inward entry nahi."],
  ["iqc", "Is period me koi quality check nahi hua."],
  ["leads", "Is period me koi lead nahi bana."],
])("%s zero-count distribution renders its actual empty message", async (id, message) => {
  const chart = charts(await render(id))[0];
  expect(renderToStaticMarkup(chart)).toContain(message);
  expect(renderToStaticMarkup(chart)).not.toContain("<ul");
});
it("lead pipeline uses readable mapped labels in stage order without changing DB tokens", async () => {
  m.read.mockResolvedValue(["Follow_Up", "Meeting_Scheduled", "Quotation_Sent", "Order_Confirmed"].map(status => ({ status, createdAt: stamp, assignedTo: "USER" })));
  const data = charts(await render("leads"))[0].props.data as Array<{ label: string; value: number }>;
  expect(data.map(r => r.label)).toEqual(["New", "Qualified", "Follow Up", "Meeting Scheduled", "Negotiation", "Quotation Sent", "Order Confirmed", "Junk", "Lost"]);
  expect(data.filter(r => r.value > 0).map(r => r.value)).toEqual([1, 1, 1, 1]);
});
it("every lead-stage display label has an explicit English dictionary entry", () => {
  for (const label of ["New", "Qualified", "Follow Up", "Meeting Scheduled", "Negotiation", "Quotation Sent", "Order Confirmed", "Junk", "Lost"]) expect(EN[label]).toBe(label);
});
it("PPC empty quantity comparison explicitly explains no plans instead of leaving a blank frame", async () => {
  const frame = nodes(await render("ppc")).find(el => el.props.title === "Planned vs recorded PPC output");
  expect(renderToStaticMarkup(frame)).toContain("Is period me koi plan nahi bana.");
});
it("PPC aggregates plan/output comparison by SKU and unit without using start quantity", async () => {
  m.read.mockResolvedValue([
    { timestamp: stamp, productionDate: stamp, status: "Ready", productSku: "FG", UOM: "PCS", plannedQty: "10", recordedOutputQty: "4", actualQty: "999", createdBy: "USER" },
    { timestamp: stamp, productionDate: stamp, status: "Ready", productSku: "FG", UOM: "PCS", plannedQty: "5", recordedOutputQty: "2", actualQty: "999", createdBy: "USER" },
  ]);
  const tree = await render("ppc");
  const plan = charts(tree).find(c => c.props.unit === "PCS");
  expect(plan?.props.rows).toEqual([{ label: "FG", planned: 15, recorded: 6 }]);
  expect(JSON.stringify(tree)).not.toContain("999");
});
it("payroll month columns are chronological and retain correct INR values", async () => {
  m.payroll.mockResolvedValue({ history: [{ month: "2026-10", netPay: 300 }, { month: "2026-08", netPay: 100 }], latest: { grossPay: 350, netPay: 300 } });
  const cs = charts(await render("payroll")); expect(cs[0].props.kind).toBe("column"); expect(cs[0].props.points).toEqual([{ label: "2026-08", value: 100 }, { label: "2026-10", value: 300 }]); expect(cs[1].props.valueSuffix).toBe(" INR");
});
it("performance compares scores and real outcomes, not team score-band donut counts", async () => {
  const summary = { score: -25, onTime: 6, delay: 4, notDone: 0, totalEvaluated: 10, penalty: 2 };
  m.performance.mockResolvedValue({ charts: [{ name: "Doer", summary }], rows: [], tasks: [], fmsRuns: [], page: 0, hasMore: false });
  const section = nodes(await render("performance")).find(el => name(el) === "PerformanceSection")!;
  const child = (section.type as (props: Record<string, unknown>) => ReactNode)(section.props);
  const cs = charts(child); expect(cs).toHaveLength(2); expect(cs[0].props.valueSuffix).toBe("%");
  expect(cs[1].props.stacked).toBe(true); expect(cs[1].props.rows).toEqual([{ label: "Doer", onTime: 6, delayed: 4, overdue: 0 }]);
});
it("money totals exclude invalid amounts and add decimal rupees in minor units", async () => {
  m.read.mockResolvedValue(["0.1", "0.2", "", "NaN", "-1"].map(amount => ({ createdAt: stamp, status: "Issued", amount })));
  expect(charts(await render("accounts"))[0].props.data).toEqual([expect.objectContaining({ value: 0.3 })]);
});

it("finished goods keeps a missing reorder point missing instead of zero", async () => {
  m.stock.mockResolvedValue({ items: [{ item: { SKU: "FG", Item_Name: "FG", UOM: "PCS", Category: "FG" }, onHand: 7, rop: null, projected: 7, status: "Not Set Up" }] });
  const chart = charts(await render("finished-goods"))[0]; expect(chart.props.rows).toEqual([{ label: "FG (FG)", stock: 7, reorder: null }]);
});
it("quality unknown units are disclosed as excluded entry counts", async () => {
  m.read.mockImplementation(async kind => kind === "ims" ? [{ Timestamp: stamp, Pass_Qty: "999", UOM: "", Verified_By: "USER" }] : []);
  const tree = await render("iqc"); expect(JSON.stringify(tree)).toContain("Unknown UOM entries"); expect(JSON.stringify(tree)).not.toContain("999");
});

it("all seven order states remain visible rather than being hidden in Other", async () => {
  const states = ["Items_Pending", "Payment_Review", "Credit_Hold", "Stock_Check", "Dispatch_Pending", "Ready_For_PDI", "Cancelled"];
  m.read.mockResolvedValue(states.map(status => ({ createdAt: stamp, status, orderValue: "10", createdBy: "USER" })));
  const data = charts(await render("orders"))[0].props.data as Array<{ label: string }>;
  expect(data).toHaveLength(7); expect(data.some(d => d.label === "Other")).toBe(false);
});
it("maintenance mine excludes other owners in the defense-in-depth pass", async () => {
  m.read.mockResolvedValue([{ id: "A", createdAt: stamp, status: "Resolved", line: "Own", workingMinutesLost: "5", reportedBy: " USER ", assignedTo: "" }, { id: "B", createdAt: stamp, status: "Resolved", line: "Other", workingMinutesLost: "900", reportedBy: "other", assignedTo: "" }]);
  expect(charts(await render("maintenance"))[0].props.data).toEqual([expect.objectContaining({ value: 5 })]);
});
it.each(REPORTS.filter(r => r.grants.length).map(r => r.id))("%s denied never reads any source", async id => {
  await render(id, []); expect(m.read).not.toHaveBeenCalled(); expect(m.task).not.toHaveBeenCalled(); expect(m.stock).not.toHaveBeenCalled(); expect(m.recurring).not.toHaveBeenCalled(); expect(m.boms).not.toHaveBeenCalled(); expect(m.performance).not.toHaveBeenCalled();
});

it("PPC unavailable FMS output stays null, never zero or a start quantity", async () => {
  m.read.mockResolvedValue([{ timestamp: stamp, productionDate: stamp, status: "In_Production", productSku: "FG", UOM: "PCS", plannedQty: "10", recordedOutputQty: null, actualQty: "999", createdBy: "USER" }]);
  const chart = charts(await render("ppc")).find(c => c.props.unit === "PCS");
  expect(chart?.props.rows).toEqual([{ label: "FG", planned: 10, recorded: null }]);
});

it("finished goods with no UOM are not compared on an invented shared quantity axis", async () => {
  m.stock.mockResolvedValue({ items: [{ item: { SKU: "FG", Item_Name: "FG", UOM: "", Category: "FG" }, onHand: 7, rop: 10, projected: 7, status: "Low" }] });
  const tree = await render("finished-goods"); expect(charts(tree).some(c => name(c) === "SeriesChart")).toBe(false);
  expect(JSON.stringify(tree)).toContain("Items without UOM");
});
it("negative downtime is invalid, not a negative maintenance loss", async () => {
  m.read.mockResolvedValue([{ id: "A", createdAt: stamp, status: "Resolved", workingMinutesLost: "-5", reportedBy: "USER" }]);
  expect(charts(await render("maintenance"))[0].props.data).toEqual([]);
});

it("maintenance all includes other owners but still forwards the explicit tenant-scoped request", async () => {
  m.read.mockResolvedValue([{ id: "A", createdAt: stamp, status: "Resolved", line: "Own", workingMinutesLost: "5", reportedBy: "USER" }, { id: "B", createdAt: stamp, status: "Resolved", line: "Other", workingMinutesLost: "9", reportedBy: "other" }]);
  const tree = await Analytics({ session: viewer, rangeKey: "all", only: "maintenance", scope: "all", tenant: { orgId: "SHARE" } as never });
  expect(charts(tree)[0].props.data).toEqual([expect.objectContaining({ value: 9 }), expect.objectContaining({ value: 5 })]);
  expect(m.read).toHaveBeenCalledWith("maintenance", expect.anything(), "all", viewer);
});
it("PPC mixed known and unavailable outputs never publishes a misleading partial aggregate", async () => {
  m.read.mockResolvedValue(["4", null].map(recordedOutputQty => ({ timestamp: stamp, productionDate: stamp, status: "Completed", productSku: "FG", UOM: "PCS", plannedQty: "5", recordedOutputQty, createdBy: "USER" })));
  const chart = charts(await render("ppc")).find(c => c.props.unit === "PCS"); expect(chart?.props.rows).toEqual([{ label: "FG", planned: 10, recorded: null }]);
});
