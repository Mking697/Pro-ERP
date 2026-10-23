import Link from "next/link";
import { readPerf04ReportRows, readPerf04TaskInputs, readPerf04Performance, readPerf04Recurring, readPerf04Boms, readPerf04Payroll, type Perf04PerformanceData, type ReportRows } from "@/lib/perf04-report-queries";
import type { SessionPayload } from "@/lib/auth/session";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/auth/guard";
import { listUsers } from "@/lib/auth/users";
import { getFrequencyLabel } from "@/lib/frequency";
import { computeMisBreakdown, formatScore, getScoreColorClass } from "@/lib/mis";
import {
  RANGE_PRESETS,
  resolveRange,
  filterTasks,
  inRange,
  bucketByDate,
  countBy,
  taskTotals,
  type DateRange,
} from "@/lib/analytics";
import { BarChart, SeriesChart, TimelineChart, ChartFrame } from "@/components/charts";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import DoerScoreDialog from "./doer-score-dialog";
import SendReportsButton from "./send-reports-button";
import { cn } from "@/lib/utils";
import DateRangeFilter from "./date-range-filter";
import { getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n";
import { getInventorySnapshot } from "@/lib/inventory/service";
import {
  canSeeReport,
  getReport,
  scopeRows,
  type ReportScope,
  type ReportViewer,
} from "@/lib/reports";
import { runWithTenant, type TenantContext } from "@/lib/tenant";
import { istDayKey } from "@/lib/timestamp";
import { getReceivablesAging, type AgingBucket } from "@/lib/accounts/accounts";
import { LEAD_STATUS_LABEL, type LeadStatus } from "@/app/leads/types";

const PERFORMANCE_PAGE_COOKIE = "perf04-performance-page";
const rangeIdentity = (range: DateRange) => `${range.key}:${istDayKey(range.from)}:${istDayKey(range.to)}`;

/** Pagination state is cosmetic only; every render still applies live auth and tenant filters. */
async function setPerf04PerformancePage(identity: string, form: FormData) {
  "use server";
  const guard = await requireSession();
  if (!guard.ok || identity.length > 100) return;
  const raw = String(form.get("page") ?? "0");
  const page = /^\d+$/.test(raw) ? Math.min(1000, Number(raw)) : 0;
  (await cookies()).set(PERFORMANCE_PAGE_COOKIE, JSON.stringify({
    orgId: guard.session.orgId, userId: guard.session.userId, identity, page,
  }), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 3600 });
}

const SERIES = [
  "var(--chart-series-1)",
  "var(--chart-series-2)",
  "var(--chart-series-3)",
] as const;

/**
 * Runs a read and turns any failure into `null`.
 *
 * A report is made of independent sections. Letting one failed sheet read take the whole
 * page down means an exhausted quota or a single disconnected sheet hides nine other
 * modules' charts that were perfectly readable.
 */
async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/**
 * Narrows one module's rows to the reader's own work.
 *
 * `null` means the read failed and must stay `null` — the section is skipped entirely
 * rather than rendering a chart built on a partial or wrong read.
 */
function scopeFor<T>(
  rows: T[] | null,
  reportId: string,
  scope: ReportScope,
  viewer: ReportViewer
): T[] | null {
  if (rows === null) return null;
  const definition = getReport(reportId);
  return definition ? scopeRows(rows, definition, scope, viewer) : rows;
}

function statusCount(items: { status: string }[], status: string): number {
  return items.filter((i) => i.status === status).length;
}

function planCount(
  plans: { status: string; timestamp: string }[],
  range: DateRange,
  status: string
): number {
  return plans.filter((p) => p.status === status && inRange(p.timestamp, range)).length;
}

/** Identity colours are assigned in fixed order and folded past three, never cycled. */
function seriesColor(i: number): string {
  return SERIES[Math.min(i, SERIES.length - 1)];
}

function validQuantity(raw: unknown): number {
  const value = raw === null || raw === "" ? NaN : Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function amountByStatus(rows: { status: string; amount: string }[]) {
  const amounts = new Map<string, number>();
  for (const row of rows) {
    if (row.amount === "" || !Number.isFinite(Number(row.amount)) || Number(row.amount) < 0) continue;
    amounts.set(row.status, (amounts.get(row.status) ?? 0) + Math.round(Number(row.amount) * 100));
  }
  return [...amounts].map(([label, paise]) => ({ label, value: paise / 100 }));
}

function moneyByDay(rows: { date: string; amount: string }[]) {
  const amounts = new Map<string, number>();
  for (const row of rows) {
    if (!row.date || !Number.isFinite(Date.parse(row.date)) || row.amount === "" || !Number.isFinite(Number(row.amount)) || Number(row.amount) < 0) continue;
    const day = istDayKey(new Date(row.date));
    amounts.set(day, (amounts.get(day) ?? 0) + Math.round(Number(row.amount) * 100));
  }
  return [...amounts].sort(([a], [b]) => a.localeCompare(b)).map(([label, paise]) => ({ label, value: paise / 100 }));
}

function shortageRows(rows: { item: { Item_Name: string; SKU: string; UOM: string }; rop: number | null; projected: number }[]) {
  return rows.filter(i => i.rop !== null && i.rop > 0 && Number.isFinite(i.projected) && i.projected < i.rop)
    .map(i => ({ label: `${i.item.Item_Name || i.item.SKU} (${i.item.SKU}, ${i.item.UOM})`, value: Number((((i.rop! - i.projected) / i.rop!) * 100).toFixed(4)), color: "var(--chart-critical)" }))
    .sort((a, b) => b.value - a.value).slice(0, 8);
}

function planComparisonRows(plans: ReportRows["ppc"][], unit: string) {
  const products = new Map<string, { label: string; planned: number; recorded: number | null }>();
  for (const plan of plans.filter(p => p.UOM === unit)) {
    const row = products.get(plan.productSku) ?? { label: plan.productSku, planned: 0, recorded: 0 };
    row.planned += validQuantity(plan.plannedQty);
    const output = plan.recordedOutputQty == null ? NaN : Number(plan.recordedOutputQty);
    row.recorded = row.recorded !== null && Number.isFinite(output) && output >= 0 ? row.recorded + output : null;
    products.set(plan.productSku, row);
  }
  return [...products.values()];
}

function orderedStages(rows: { status: string }[]) {
  const stages: LeadStatus[] = ["New", "Qualified", "Follow_Up", "Meeting_Scheduled", "Negotiation", "Quotation_Sent", "Order_Confirmed", "Junk", "Lost"];
  return stages.map(status => ({ label: LEAD_STATUS_LABEL[status], value: rows.filter(r => r.status === status).length }));
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-base font-semibold tracking-tight">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">{children}</div>
    </section>
  );
}

export default async function Analytics({
  session,
  rangeKey,
  from,
  to,
  only,
  hideFilter = false,
  tenant,
  scope = "mine",
}: {
  session: SessionPayload;
  rangeKey: string;
  from?: string;
  to?: string;
  /**
   * An explicit tenant, for the public share page.
   *
   * It has to be applied around the *data fetch* rather than around the JSX. React
   * renders an async child after the parent's own function has returned, so a
   * `runWithTenant` wrapped around the element is already out of scope by the time this
   * component runs — and `getTenant()` would quietly fall back to the visitor's session
   * cookie, showing a signed-in stranger their own organization's figures under someone
   * else's report. Wrapping the awaited read keeps the context where it is needed.
   */
  tenant?: TenantContext;
  /**
   * Render one report instead of all of them.
   *
   * This also decides what gets read: opening the inward report should not spend the
   * shared Sheets quota on inventory, BOM and PPC sheets nobody asked to see.
   */
  only?: string;
  hideFilter?: boolean;
  /**
   * Whose work to show.
   *
   * A grant says which reports a person may open; it never said whose rows they would see
   * inside one, and the answer used to be everybody's — so anyone who could run a quality
   * check could also read every party name and invoice number the company held. The
   * caller resolves this against the reader's privileges (see `resolveReportScope`); by
   * the time it arrives here it is already what the reader is entitled to.
   */
  scope?: ReportScope;
}) {
  const t = await getT();
  const range = resolveRange(rangeKey, from, to);
  const access = session.access;

  // A section renders when the reader is allowed it and, in single-report mode, when it
  // is the one asked for. Both the "may I" and the "which one" questions run through the
  // shared registry, so a report can never appear here but 404 when opened on its own.
  const shows = (id: string) => {
    if (only && only !== id) return false;
    const def = getReport(id);
    return def ? canSeeReport(def, access) : false;
  };
  const needs = (id: string) => shows(id);

  let performancePage = 0;
  if (needs("performance")) {
    try {
      const value = JSON.parse((await cookies()).get(PERFORMANCE_PAGE_COOKIE)?.value ?? "null");
      if (value?.orgId === session.orgId && value?.userId === session.userId && value?.identity === rangeIdentity(range)) {
        performancePage = Number.isInteger(value.page) ? Math.min(1000, Math.max(0, value.page)) : 0;
      }
    } catch { /* Missing/malformed cosmetic pagination never affects authorization. */ }
  }

  // Only read the modules this viewer is actually allowed to see — every extra read is
  // wasted work for no one's benefit.
  //
  // No caching here anymore. This used to run through `tenantCached` (30s TTL, per
  // organization) purely to survive Google Sheets' per-minute API quota and full-sheet
  // scan cost — CLAUDE.md documents that quota being hit for real during development. A
  // report is now a handful of indexed `WHERE org_id = $1` reads against Postgres, which
  // is both fast enough not to need it and, for a share link in particular, a real
  // correctness improvement: a public link served stale data for up to 30 seconds before,
  // and a viewer refreshing to check "is this current" got a false negative. If a future
  // report render set is measurably expensive again, add a narrowly-scoped cache then —
  // per the migration plan's own stated default, this isn't pre-built speculatively.
  //
  // Each read still degrades to null on its own rather than throwing, so one failure (a
  // bad query, a genuinely empty module) leaves the rest of the report standing.
  const read = () =>
    Promise.all([
      needs("tasks") || needs("delegation")
        ? safe(() => readPerf04TaskInputs(range, session.userId, needs("delegation")))
        : null,
      needs("delegation")
        ? listUsers().catch(() => [])
        : Promise.resolve([]),
      needs("recurring") ? safe(() => readPerf04Recurring(scope, session)) : null,
      needs("inward") ? safe(() => readPerf04ReportRows("inward", range, scope, session)) : null,
      needs("iqc") ? safe(() => readPerf04ReportRows("failures", range, scope, session)) : null,
      needs("iqc") || needs("ims") ? safe(() => readPerf04ReportRows("ims", range, scope, session)) : null,
      needs("inventory") || needs("finished-goods") ? safe(() => getInventorySnapshot()) : null,
      needs("indents") ? safe(() => readPerf04ReportRows("indents", range, scope, session)) : null,
      needs("bom") ? safe(() => readPerf04Boms(scope, session)) : null,
      needs("ppc") ? safe(() => readPerf04ReportRows("ppc", range, scope, session)) : null,
      needs("performance") ? safe(() => readPerf04Performance(range, performancePage)) : null,
      needs("leave") ? safe(() => readPerf04ReportRows("leave", range, scope, session)) : null,
      needs("leads") ? safe(() => readPerf04ReportRows("leads", range, scope, session)) : null,
      needs("orders") ? safe(() => readPerf04ReportRows("orders", range, scope, session)) : null,
      needs("pdi") ? safe(() => readPerf04ReportRows("pdi", range, scope, session)) : null,
      needs("tms") ? safe(() => readPerf04ReportRows("tms", range, scope, session)) : null,
      needs("accounts") ? safe(() => readPerf04ReportRows("invoices", range, scope, session)) : null,
      needs("accounts") ? safe(() => readPerf04ReportRows("bills", range, scope, session)) : null,
      needs("dispatch") ? safe(() => readPerf04ReportRows("dispatch", range, scope, session)) : null,
      needs("payroll") ? safe(() => readPerf04Payroll(range, session.userId)) : null,
      needs("maintenance") ? safe(() => readPerf04ReportRows("maintenance", range, scope, session)) : null,
      needs("accounts") ? safe(async () => {
        const { bucketTotals, grandTotal } = await getReceivablesAging();
        return { bucketTotals, grandTotal };
      }) : null,
    ]);

  const [
    allTasks,
    users,
    allRules,
    allInward,
    allFailures,
    allIms,
    stock,
    allIndents,
    allBoms,
    allPlans,
    performance,
    allLeaves,
    allLeads,
    allOrders,
    allPdi,
    allTms,
    allInvoices,
    allBills,
    allDispatches,
    payslips,
    allMaintenance,
    aging,
  ] = tenant ? await runWithTenant(tenant, read) : await read();

  // SQL already applies the same range/ownership to thin report-only projections.
  // Keep the registry scope pass as defense in depth; never truncate chart inputs.
  const maintenance = scopeFor(allMaintenance, "maintenance", scope, session);
  const rules = allRules;
  const inward = scopeFor(allInward, "inward", scope, session);
  const failures = scopeFor(allFailures, "iqc", scope, session);
  const ims = scopeFor(allIms, "ims", scope, session);
  const indents = scopeFor(allIndents, "indents", scope, session);
  const boms = allBoms;
  const plans = scopeFor(allPlans, "ppc", scope, session);
  const leaveRecords = scopeFor(allLeaves, "leave", scope, session);
  const leads = scopeFor(allLeads, "leads", scope, session);
  const orders = scopeFor(allOrders, "orders", scope, session);
  const pdi = scopeFor(allPdi, "pdi", scope, session);
  const tms = scopeFor(allTms, "tms", scope, session);
  const dispatches = scopeFor(allDispatches, "dispatch", scope, session);
  // Accounts combines two sources (Receivables/Payables) with no shared per-person
  // meaning — like Inventory, there is no "my invoice" to narrow either to.
  const invoices = allInvoices;
  const bills = allBills;
  const fgItems = (stock?.items ?? []).filter((i) => i.item.Category === "FG");

  const tasks = filterTasks(allTasks ?? [], range);
  const myTasks = tasks.filter((t) => t.Assigned_To === session.userId);
  const totals = taskTotals(myTasks);

  const outcomeSlices = [
    { label: t("On Time"), value: totals.onTime, color: "var(--chart-good)" },
    { label: t("Delay Done"), value: totals.delay, color: "var(--chart-warning)" },
    { label: t("Not Done"), value: totals.overdue, color: "var(--chart-critical)" },
  ];

  const reportInputs: Record<string, unknown[]> = {
    tasks: [allTasks], delegation: [allTasks], recurring: [rules], inward: [inward], iqc: [failures, ims], ims: [ims],
    inventory: [stock], indents: [indents], bom: [boms], ppc: [plans], performance: [performance], leave: [leaveRecords],
    "finished-goods": [stock], leads: [leads], orders: [orders], pdi: [pdi], tms: [tms], accounts: [invoices, bills], dispatch: [dispatches], payroll: [payslips], maintenance: [maintenance],
  };
  const unavailable = Object.keys(reportInputs).filter(id => shows(id) && reportInputs[id].some(input => input == null));

  return (
    <div className="space-y-8">
      {unavailable.map(id => <p key={id} role="status" className="rounded border p-4 text-sm">{t(getReport(id)?.label ?? id)} — {t("Report data unavailable. Baad me retry karein; missing data zero nahi hai.")}</p>)}
      <p className="text-xs text-muted-foreground">{t("Unit na ho to ginti entries ki hai. Khali dates par entries record nahi hui; invalid quantities aur amounts exclude hain.")}</p>
      {!hideFilter && (
        <DateRangeFilter active={range} presets={RANGE_PRESETS} from={from} to={to} />
      )}

      {shows("tasks") && allTasks && (
      <Section
        title={t("Mera kaam")}
        description={`${range.label} — ${t("Aapko assign hue tasks.")}`}
      >
        <ChartFrame
          title={t("Result ka batwara")}
          hint={t("Har rang ke saath uski ginti bhi likhi hai — sirf rang par nahi jaana padta.")}
        >
          <BarChart emptyWhenZero
              valueSuffix={t(" outcomes")}
            data={outcomeSlices}


            emptyMessage={t("Is period me koi task evaluate nahi hua.")}
          />
        </ChartFrame>

        <ChartFrame title={t("Tasks kab bane")} hint={t("Aapko assign hue tasks, samay ke saath.")}>
          <TimelineChart
            kind="line" seriesLabel={t("Entries")} valueSuffix={t(" entries")}
            points={bucketByDate(myTasks.map((task) => task.Created_At), range)}
            emptyMessage={t("Is period me koi data nahi.")}
          />
        </ChartFrame>
      </Section>
      )}

      {shows("delegation") && allTasks && (
        <Section
          title="Delegation"
          description={t("Jo tasks aapne doosron ko diye.")}
        >
          <ChartFrame title={t("Kisko kitne tasks diye")}>
            <BarChart
              valueSuffix={t(" tasks")}
              data={countBy(
                tasks.filter((t) => t.Assigned_By === session.userId),
                (t) => users.find((u) => u.User_ID === t.Assigned_To)?.Full_Name ?? t.Assigned_To
              ).map((b, i) => ({ ...b, color: seriesColor(i) }))}
              emptyMessage={t("Is period me aapne koi task assign nahi kiya.")}
            />
          </ChartFrame>

          <ChartFrame title={t("Priority ke hisaab se")}>
            <BarChart
              valueSuffix={t(" tasks")}
              data={countBy(
                tasks.filter((t) => t.Assigned_By === session.userId),
                (t) => t.Priority
              ).map((b, i) => ({ ...b, label: t(b.label), color: seriesColor(i) }))}
              emptyMessage={t("Is period me aapne koi task assign nahi kiya.")}
            />
          </ChartFrame>
        </Section>
      )}

      {shows("recurring") && rules && (
        <Section title="Recurring" description={t("Repeating rules aur unki haalat.")}>
          <ChartFrame title={t("Active vs Paused")}>
            <BarChart emptyWhenZero
              valueSuffix={t(" rules")}
              data={[
                {
                  label: t("Active"),
                  value: rules?.statuses.find(r => r.label === "Active")?.value ?? 0,
                  color: "var(--chart-good)",
                },
                {
                  label: t("Paused"),
                  value: rules?.statuses.filter(r => r.label !== "Active").reduce((sum, r) => sum + r.value, 0) ?? 0,
                  color: "var(--chart-warning)",
                },
              ]}


              emptyMessage={t("Koi recurring rule nahi hai.")}
            />
          </ChartFrame>

          <ChartFrame title={t("Frequency ke hisaab se")}>
            <BarChart
              valueSuffix={t(" rules")}
              data={(rules?.frequencies ?? []).map(r => ({ label: getFrequencyLabel(r.frequency), value: r.value })).map(
                (b, i) => ({ ...b, label: t(b.label), color: seriesColor(i) })
              )}
              emptyMessage={t("Koi recurring rule nahi hai.")}
            />
          </ChartFrame>
        </Section>
      )}

      {shows("inward") && inward && (
        <Section title="Inward" description={`${range.label} — ${t("Material inward entries.")}`}>
          <ChartFrame title="IQC status">
            <BarChart emptyWhenZero
              valueSuffix={t(" entries")}
              data={[
                {
                  label: t("Verified"),
                  value: inward.filter(
                    (e) => e.IQC_Status === "Verified" && inRange(e.Timestamp, range)
                  ).length,
                  color: "var(--chart-good)",
                },
                {
                  label: t("Pending"),
                  value: inward.filter(
                    (e) => e.IQC_Status !== "Verified" && inRange(e.Timestamp, range)
                  ).length,
                  color: "var(--chart-warning)",
                },
              ]}
              emptyMessage={t("Is period me koi inward entry nahi.")}
            />
          </ChartFrame>

          <ChartFrame title={t("Entries kab aayi")}>
            <TimelineChart
            kind="area" seriesLabel={t("Entries")} valueSuffix={t(" entries")}
              emptyMessage={t("Is period me koi inward entry nahi.")}
              points={bucketByDate(
                inward.filter((e) => inRange(e.Timestamp, range)).map((e) => e.Timestamp),
                range
              )}
            />
          </ChartFrame>
        </Section>
      )}

      {shows("iqc") && failures && ims && (
        <Section title="IQC" description={t("Quality check ka nateeja.")}>
          <ChartFrame title={t("Pass vs Fail quantity")} hint={t("UOM alag rakhe hain; unit current item master se hai. Bina UOM ki entries quantity totals me nahi hain.")}>
            {[...new Set([...ims, ...failures].map(r => r.UOM?.trim()).filter(Boolean))].sort().map(unit => (
              <div key={unit} className="mb-4">
                <BarChart data={[
                  { label: t("Pass"), value: ims.filter(r => r.UOM?.trim() === unit).reduce((n, r) => n + validQuantity(r.Pass_Qty), 0), color: "var(--chart-good)" },
                  { label: t("Fail"), value: failures.filter(r => r.UOM?.trim() === unit).reduce((n, r) => n + validQuantity(r.Fail_Qty), 0), color: "var(--chart-critical)" },
                ]} valueSuffix={` ${unit}`} emptyMessage={t("Is period me koi quality check nahi hua.")} />
              </div>
            ))}
            <BarChart emptyWhenZero data={[
              { label: t("Pass entries"), value: ims.length, color: "var(--chart-good)" },
              { label: t("Fail entries"), value: failures.length, color: "var(--chart-critical)" },
              { label: t("Unknown UOM entries"), value: [...ims, ...failures].filter(r => !r.UOM?.trim()).length, color: "var(--chart-axis)" },
            ]} valueSuffix={t(" entries")} emptyMessage={t("Is period me koi quality check nahi hua.")} />
          </ChartFrame>

          <ChartFrame title={t("Rejection ke kaaran")}>
            <BarChart
              valueSuffix={t(" entries")}
              data={countBy(
                failures.filter((r) => inRange(r.Timestamp, range)),
                (r) => r.Fail_Reason
              ).map((b) => ({ ...b, color: "var(--chart-critical)" }))}
              emptyMessage={t("Koi rejection nahi — achhi baat hai.")}
            />
          </ChartFrame>
        </Section>
      )}

      {shows("ims") && ims && (
        <Section title="IMS" description={t("Verified stock jo andar aaya.")}>
          <ChartFrame title={t("Supplier ke hisaab se verified entries")}>
            <BarChart
              data={countBy(
                ims.filter((r) => inRange(r.Timestamp, range)),
                (r) => r.Party_Name
              ).map((b, i) => ({ ...b, color: seriesColor(i) }))}
              valueSuffix={t(" entries")}
              emptyMessage={t("Is period me koi verified stock nahi.")}
            />
          </ChartFrame>

          <ChartFrame title={t("Stock kab aaya")}>
            <TimelineChart
            kind="area" seriesLabel={t("Entries")} valueSuffix={t(" entries")}
              emptyMessage={t("Is period me koi verified stock nahi.")}
              points={bucketByDate(
                ims.filter((r) => inRange(r.Timestamp, range)).map((r) => r.Timestamp),
                range
              )}
              color="var(--chart-series-3)"
            />
          </ChartFrame>
        </Section>
      )}

      {shows("inventory") && stock && (
        <Section
          title={t("Inventory")}
          description={t("Aaj ka stock — ye period filter par nahi badalta.")}
        >
          <ChartFrame
            title={t("Stock status")}
            hint={t("Free stock ko reorder point se tolkar.")}
          >
            <BarChart emptyWhenZero
              valueSuffix={t(" items")}
              data={[
                { label: t("Healthy"), value: statusCount(stock.items, "Healthy"), color: "var(--chart-good)" },
                { label: t("Low"), value: statusCount(stock.items, "Low"), color: "var(--chart-warning)" },
                { label: t("Critical"), value: statusCount(stock.items, "Critical"), color: "var(--chart-critical)" },
                { label: t("Out of Stock"), value: statusCount(stock.items, "Out of Stock"), color: "var(--chart-critical)" },
                { label: t("Not Set Up"), value: statusCount(stock.items, "Not Set Up"), color: "var(--chart-axis)" },
              ]}
              emptyMessage={t("Abhi koi item nahi hai.")}
            />
          </ChartFrame>

          <ChartFrame
            title={t("Reorder point se sabse neeche")}
            hint={t("Apne ROP se kitne pratishat neeche; alag units ki quantities compare nahi hoti.")}
          >
            <BarChart
              data={shortageRows(stock.items)}
              valueSuffix="%"
              emptyMessage={t("Abhi kisi item ko order ki zaroorat nahi")}
            />
          </ChartFrame>
        </Section>
      )}

      {shows("indents") && indents && (
        <Section
          title={t("Indents")}
          description={`${range.label} — ${t("purchase requests.")}`}
        >
          <ChartFrame title={t("Indent status")}>
            <BarChart
              valueSuffix={t(" entries")}
              data={countBy(
                indents.filter((i) => inRange(i.Timestamp, range)),
                (i) => i.Status, 30
              ).map((b, idx) => ({ ...b, label: t(b.label.replaceAll("_", " ")), color: seriesColor(idx) }))}
              emptyMessage={t("Is period me koi indent nahi.")}
            />
          </ChartFrame>

          <ChartFrame title={t("Indents kab bane")}>
            <TimelineChart
            kind="line" seriesLabel={t("Entries")} valueSuffix={t(" entries")}
              emptyMessage={t("Is period me koi indent nahi.")}
              points={bucketByDate(
                indents.filter((i) => inRange(i.Timestamp, range)).map((i) => i.Timestamp),
                range
              )}
            />
          </ChartFrame>
        </Section>
      )}

      {shows("bom") && boms && (
        <Section
          title={t("BOM")}
          description={t("Kis product me kitne item lagte hain — aaj ki active BOMs.")}
        >
          <ChartFrame
            title={t("Product me kitne item")}
            hint={t("Latest 10 active BOM products; component rows ki ginti, material quantity nahi.")}
          >
            <BarChart
              valueSuffix={t(" components")}
              data={boms.active
                .map((b, idx) => ({
                  label: b.productName,
                  value: b.lineCount,
                  color: seriesColor(idx),
                }))}
              emptyMessage={t("Abhi koi BOM nahi hai")}
            />
          </ChartFrame>

          <ChartFrame title={t("Active vs Archived")}>
            <BarChart emptyWhenZero
              valueSuffix={t(" versions")}
              data={[
                {
                  label: t("Active"),
                  value: boms.statuses.find(b => b.label === "Active")?.value ?? 0,
                  color: "var(--chart-good)",
                },
                {
                  label: t("Archived"),
                  value: boms.statuses.filter(b => b.label !== "Active").reduce((sum, b) => sum + b.value, 0),
                  color: "var(--chart-axis)",
                },
              ]}
              emptyMessage={t("Abhi koi BOM nahi hai")}
            />
          </ChartFrame>
        </Section>
      )}

      {shows("ppc") && plans && (
        <Section
          title={t("Production Planning")}
          description={`${range.label} — ${t("production plans aur unki haalat.")}`}
        >
          <ChartFrame title={t("Planned vs recorded PPC output")} hint={t("Selected period me bane plans ka cumulative PPC ledger output. Start quantity output nahi; FMS final output ya unit mismatch par comparison unavailable (—). Cancelled plans bhi cohort me hain.")}>
            {[...new Set(plans.map(p => p.UOM).filter(Boolean))].map(unit => <SeriesChart key={unit}
              rows={planComparisonRows(plans, unit)}
              series={[{ key: "planned", label: t("Planned quantity"), color: SERIES[0] }, { key: "recorded", label: t("Recorded PPC output"), color: SERIES[2] }]}
              unit={unit} emptyMessage={t("Is period me koi plan nahi bana.")} />)}
            {plans.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">{t("Is period me koi plan nahi bana.")}</p>}
            {plans.some(p => !p.UOM) && <p className="text-xs text-muted-foreground">{t("Plans without UOM are excluded from quantity comparisons.")}</p>}
          </ChartFrame>
          <ChartFrame title={t("Plan status")}>
            <BarChart emptyWhenZero
              valueSuffix={t(" plans")}
              data={[
                { label: t("Ready"), value: planCount(plans, range, "Ready"), color: "var(--chart-good)" },
                { label: t("Shortage"), value: planCount(plans, range, "Shortage"), color: "var(--chart-critical)" },
                { label: t("In Production"), value: planCount(plans, range, "In_Production"), color: "var(--chart-series-1)" },
                { label: t("Completed"), value: planCount(plans, range, "Completed"), color: "var(--chart-series-3)" },
                { label: t("Cancelled"), value: planCount(plans, range, "Cancelled"), color: "var(--chart-axis)" },
              ]}
              emptyMessage={t("Is period me koi plan nahi bana.")}
            />
          </ChartFrame>

          <ChartFrame
            title={t("Production kab honi hai")}
            hint={t("Selected period me bane plans ki scheduled production dates; dates period ke bahar ho sakti hain.")}
          >
            <TimelineChart
            kind="line" seriesLabel={t("Entries")} valueSuffix={t(" entries")}
              emptyMessage={t("Is period me koi plan nahi bana.")}
              points={bucketByDate(
                plans.filter((p) => inRange(p.timestamp, range)).map((p) => p.productionDate),
                range
              )}
            />
          </ChartFrame>
        </Section>
      )}

      {shows("leave") && leaveRecords && (
        <Section
          title={t("Leave")}
          description={`${range.label} — ${t("Filed leaves aur unka approval status.")}`}
        >
          <ChartFrame title={t("Leave status")}>
            <BarChart
              valueSuffix={t(" requests")}
              data={countBy(
                leaveRecords.filter((l) => inRange(l.createdAt, range)),
                (l) => l.status, 30
              ).map((b, i) => ({ ...b, label: t(b.label.replaceAll("_", " ")), color: seriesColor(i) }))}
              emptyMessage={t("Is period me koi leave file nahi hui.")}
            />
          </ChartFrame>

          <ChartFrame title={t("Leave Type ke hisaab se")}>
            <BarChart
              valueSuffix={t(" requests")}
              data={countBy(
                leaveRecords.filter((l) => inRange(l.createdAt, range)),
                (l) => l.leaveType, 30
              ).map((b, i) => ({ ...b, label: t(b.label), color: seriesColor(i) }))}
              emptyMessage={t("Is period me koi leave file nahi hui.")}
            />
          </ChartFrame>
        </Section>
      )}

      {shows("finished-goods") && stock && (
        <Section
          title={t("Finished Goods")}
          description={t("Finished Goods ka aaj ka live stock — ye period filter par nahi badalta.")}
        >
          <ChartFrame title={t("Product stock aur reorder point")} hint={t("Har product apni UOM me; alag units ke liye alag charts.")}>
            {[...new Set(fgItems.map(i => i.item.UOM).filter(unit => unit.trim()))].map(unit => <SeriesChart key={unit}
              rows={fgItems.filter(i => i.item.UOM === unit).map(i => ({ label: `${i.item.Item_Name} (${i.item.SKU})`, stock: i.onHand, reorder: i.rop }))}
              series={[{ key: "stock", label: t("On hand"), color: SERIES[0] }, { key: "reorder", label: t("Reorder point"), color: SERIES[1] }]}
              unit={unit || t("UOM unavailable")} emptyMessage={t("Abhi koi FG item nahi hai.")} />)}
            {fgItems.some(i => !i.item.UOM.trim()) && <p className="text-xs text-muted-foreground">{t("Items without UOM are excluded from quantity comparisons.")}</p>}
            {fgItems.length === 0 && <BarChart data={[]} emptyMessage={t("Abhi koi FG item nahi hai.")} />}
          </ChartFrame>

          <ChartFrame
            title={t("Reorder point se sabse neeche")}
            hint={t("Apne ROP se kitne pratishat neeche; alag units ki quantities compare nahi hoti.")}
          >
            <BarChart
              data={shortageRows(fgItems)}
              valueSuffix="%"
              emptyMessage={t("Abhi kisi item ko order ki zaroorat nahi")}
            />
          </ChartFrame>
        </Section>
      )}

      {shows("leads") && leads && (
        <Section
          title={t("Leads")}
          description={`${range.label} — ${t("Leads aur unki pipeline stage.")}`}
        >
          <ChartFrame title={t("Pipeline stage")} hint={t("Aaj ki stage distribution; historical conversion rate nahi.")}>
            <BarChart emptyWhenZero
              valueSuffix={t(" leads")}
              data={orderedStages(leads).map((b, i) => ({ ...b, label: t(b.label), color: seriesColor(i) }))}
              emptyMessage={t("Is period me koi lead nahi bana.")}
            />
          </ChartFrame>

          <ChartFrame title={t("Leads kab bane")}>
            <TimelineChart
            kind="line" seriesLabel={t("Entries")} valueSuffix={t(" entries")}
              emptyMessage={t("Is period me koi lead nahi bana.")}
              points={bucketByDate(
                leads.filter((l) => inRange(l.createdAt, range)).map((l) => l.createdAt),
                range
              )}
            />
          </ChartFrame>
        </Section>
      )}

      {shows("orders") && orders && (
        <Section
          title={t("Orders")}
          description={`${range.label} — ${t("Sales orders aur unki haalat.")}`}
        >
          <ChartFrame title={t("Order status")}>
            <BarChart
              valueSuffix={t(" orders")}
              data={countBy(
                orders.filter((o) => inRange(o.createdAt, range)),
                (o) => o.status, 30
              ).map((b, i) => ({ ...b, label: t(b.label.replaceAll("_", " ")), color: seriesColor(i) }))}
              emptyMessage={t("Is period me koi order nahi bana.")}
            />
          </ChartFrame>

          <ChartFrame title={t("Orders kab bane")}>
            <TimelineChart
            kind="line" seriesLabel={t("Entries")} valueSuffix={t(" entries")}
              emptyMessage={t("Is period me koi order nahi bana.")}
              points={bucketByDate(
                orders.filter((o) => inRange(o.createdAt, range)).map((o) => o.createdAt),
                range
              )}
            />
          </ChartFrame>
          <ChartFrame title={t("Booked order value (INR)")} hint={t("Cancelled orders exclude hain; ye revenue ya collection nahi hai.")}>
            <TimelineChart points={moneyByDay(orders.filter(o => o.status !== "Cancelled").map(o => ({ date: o.createdAt, amount: o.orderValue })))}
              valueSuffix=" INR" seriesLabel={t("Booked value")} kind="column" emptyMessage={t("Is period me koi order nahi bana.")} />
          </ChartFrame>
        </Section>
      )}

      {shows("pdi") && pdi && (
        <Section
          title={t("PDI")}
          description={`${range.label} — ${t("Pre-Dispatch Inspection ka result.")}`}
        >
          <ChartFrame title={t("Inspection status")}>
            <BarChart emptyWhenZero
              valueSuffix={t(" entries")}
              data={[
                {
                  label: t("Passed"),
                  value: pdi.filter((p) => p.status === "Passed" && inRange(p.createdAt, range)).length,
                  color: "var(--chart-good)",
                },
                {
                  label: t("Pending"),
                  value: pdi.filter((p) => p.status === "Pending" && inRange(p.createdAt, range)).length,
                  color: "var(--chart-warning)",
                },
              ]}
              emptyMessage={t("Is period me koi PDI inspection nahi hui.")}
            />
          </ChartFrame>

          <ChartFrame title={t("Inspections kab hui")}>
            <TimelineChart
            kind="column" seriesLabel={t("Entries")} valueSuffix={t(" entries")}
              emptyMessage={t("Is period me koi PDI inspection nahi hui.")}
              points={bucketByDate(
                pdi.filter((p) => inRange(p.createdAt, range)).map((p) => p.createdAt),
                range
              )}
            />
          </ChartFrame>
        </Section>
      )}

      {shows("tms") && tms && (
        <Section
          title={t("TMS")}
          description={`${range.label} — ${t("Transport shipments aur unki haalat.")}`}
        >
          <ChartFrame title={t("Shipment status")}>
            <BarChart emptyWhenZero
              valueSuffix={t(" entries")}
              data={[
                {
                  label: t("At Loading Dock"),
                  value: tms.filter((s) => s.status === "At_Loading_Dock" && inRange(s.createdAt, range)).length,
                  color: "var(--chart-good)",
                },
                {
                  label: t("Pending"),
                  value: tms.filter((s) => s.status === "Pending" && inRange(s.createdAt, range)).length,
                  color: "var(--chart-warning)",
                },
              ]}
              emptyMessage={t("Is period me koi shipment plan nahi hua.")}
            />
          </ChartFrame>

          <ChartFrame title={t("Shipments kab plan hue")}>
            <TimelineChart
            kind="line" seriesLabel={t("Entries")} valueSuffix={t(" entries")}
              emptyMessage={t("Is period me koi shipment plan nahi hua.")}
              points={bucketByDate(
                tms.filter((s) => inRange(s.createdAt, range)).map((s) => s.createdAt),
                range
              )}
            />
          </ChartFrame>
        </Section>
      )}

      {shows("accounts") && invoices && bills && (
        <Section
          title={t("Accounts")}
          description={`${range.label} — ${t("Invoices aur Bills ka status.")}`}
        >
          <ChartFrame title={t("Invoice billed amount by status (INR)")} hint={t("Billed amounts, outstanding nahi; payments aur credit adjustments yahan reconcile nahi hain.")}>
            <BarChart
              valueSuffix=" INR"
              data={amountByStatus(invoices).map((b, i) => ({ ...b, label: t(b.label), color: seriesColor(i) }))}
              emptyMessage={t("Is period me koi invoice nahi bani.")}
            />
          </ChartFrame>

          <ChartFrame title={t("Bill amount by status (INR)")} hint={t("Billed amounts, outstanding nahi; payments aur credit adjustments yahan reconcile nahi hain.")}>
            <BarChart
              valueSuffix=" INR"
              data={amountByStatus(bills).map((b, i) => ({ ...b, label: t(b.label), color: seriesColor(i) }))}
              emptyMessage={t("Is period me koi bill nahi bana.")}
            />
          </ChartFrame>
        </Section>
      )}

      {shows("accounts") && (
        <Section title={t("Current receivables aging (INR)")} description={t("Current all-time snapshot; independent of the selected period and mine/all scope.")}>
          <ChartFrame title={t("Current receivables aging (INR)")} hint={t("Issued invoice totals per order minus order payments, aged from the earliest Issued invoice; not due-date overdue aging. 90+ means more than 90 days.")}>
            {aging ? <>
              <p className="mb-3 text-sm tabular-nums">{t("Total outstanding (INR)")}: {aging.grandTotal}</p>
              <BarChart emptyWhenZero data={(["0-30", "31-60", "61-90", "90+"] as AgingBucket[]).map((label, i) => ({ label, value: aging.bucketTotals[label], color: seriesColor(i) }))}
                valueSuffix=" INR" emptyMessage={t("No current outstanding receivables.")} />
            </> : <p role="status" className="text-sm text-muted-foreground">{t("Receivables aging unavailable; missing data is not zero.")}</p>}
          </ChartFrame>
        </Section>
      )}

      {shows("dispatch") && dispatches && (
        <Section
          title={t("Dispatch")}
          description={`${range.label} — ${t("Dispatch aur unki delivery status.")}`}
        >
          <ChartFrame title={t("Dispatch status")}>
            <BarChart emptyWhenZero
              valueSuffix={t(" entries")}
              data={[
                {
                  label: t("In Transit"),
                  value: dispatches.filter((d) => d.status === "In_Transit" && inRange(d.createdAt, range)).length,
                  color: "var(--chart-warning)",
                },
                {
                  label: t("Dispatched"),
                  value: dispatches.filter((d) => d.status === "Dispatched" && inRange(d.createdAt, range)).length,
                  color: "var(--chart-series-1)",
                },
                {
                  label: t("Delivered"),
                  value: dispatches.filter((d) => d.status === "Delivered" && inRange(d.createdAt, range)).length,
                  color: "var(--chart-good)",
                },
              ]}
              emptyMessage={t("Is period me koi dispatch nahi hua.")}
            />
          </ChartFrame>

          <ChartFrame title={t("Dispatch kab hue")}>
            <TimelineChart
            kind="line" seriesLabel={t("Entries")} valueSuffix={t(" entries")}
              emptyMessage={t("Is period me koi dispatch nahi hua.")}
              points={bucketByDate(
                dispatches.filter((d) => inRange(d.createdAt, range)).map((d) => d.createdAt),
                range
              )}
            />
          </ChartFrame>
        </Section>
      )}

      {shows("payroll") && payslips && (
        <Section
          title={t("Payroll")}
          description={`${range.label} — ${t("Aapki apni payslip history.")}`}
        >
          <ChartFrame title={t("Mahine ke hisaab se Net Pay")} hint={t("Selected period ki latest 12 finalized payslips, chronological month order me.")}>
            <TimelineChart points={[...payslips.history].sort((a, b) => a.month.localeCompare(b.month)).map(p => ({ label: p.month, value: p.netPay }))}
              valueSuffix=" INR" seriesLabel={t("Net Pay")} kind="column" emptyMessage={t("Is period me koi payslip nahi bani.")} />
          </ChartFrame>

          <ChartFrame title={t("Latest payslip — Gross vs Deduction")} hint={t("Latest finalized payslip; period filter se alag.")}>
            <BarChart
              valueSuffix=" INR"
              data={
                payslips.latest === null
                  ? []
                  : [
                      {
                        label: t("Gross Pay"),
                        value: payslips.latest.grossPay,
                        color: "var(--chart-good)",
                      },
                      {
                        label: t("Deduction"),
                        value: Math.max(0, payslips.latest.grossPay - payslips.latest.netPay),
                        color: "var(--chart-warning)",
                      },
                    ]
              }
              emptyMessage={t("Is period me koi payslip nahi bani.")}
            />
          </ChartFrame>
        </Section>
      )}

      {shows("maintenance") && maintenance && (
        <Section title={t("Maintenance")} description={t("Reported requests; recorded resolved working downtime only, open duration ka estimate nahi.")}>
          <ChartFrame title={t("Recorded downtime ranking (minutes)")} hint={t("Resolved requests ke recorded working minutes; missing values zero nahi hain.")}>
            <BarChart data={maintenance.filter(r => r.status === "Resolved" && r.workingMinutesLost !== null && Number.isFinite(Number(r.workingMinutesLost)) && Number(r.workingMinutesLost) >= 0).map(r => ({ label: `${r.line || r.id} (${r.id})`, value: Number(r.workingMinutesLost), color: "var(--chart-critical)" })).sort((a, b) => b.value - a.value)} valueSuffix=" min" emptyMessage={t("No recorded downtime in this period.")} />
          </ChartFrame>
          <ChartFrame title={t("Request status")}><BarChart data={countBy(maintenance, r => r.status, 20).map((r, i) => ({ ...r, label: t(r.label.replaceAll("_", " ")), color: seriesColor(i) }))} valueSuffix={t(" requests")} emptyMessage={t("No maintenance requests in this period.")} /></ChartFrame>
          <ChartFrame title={t("Requests by reported date")}><TimelineChart points={bucketByDate(maintenance.map(r => r.createdAt), range)} kind="line" seriesLabel={t("Requests")} valueSuffix={t(" requests")} emptyMessage={t("No maintenance requests in this period.")} /></ChartFrame>
        </Section>
      )}

      {shows("performance") && performance && (
        <PerformanceSection
          data={performance}
          range={range}
          t={t}
        />
      )}
    </div>
  );
}

function PerformanceSection({
  data,
  range,
  t,
}: {
  data: Perf04PerformanceData;
  range: DateRange;
  t: Translator;
}) {
  const { rows, tasks, fmsRuns } = data;
  const scored = data.charts.filter((r) => r.summary.score !== null);

  // The dates go back out as IST days, the same way they came in. `toISOString()` would
  // render an IST midnight as the previous day in UTC, so the downloaded CSV would cover
  // a window one day off from the screen it was exported from.
  const rangeQuery = `range=${range.key}${
    range.key === "custom"
      ? `&from=${istDayKey(range.from)}&to=${istDayKey(range.to)}`
      : ""
  }`;
  const exportHref = `/api/analytics/export?${rangeQuery}`;
  const doerExportHref = (userId: string) => `/api/analytics/export/doer/${userId}?${rangeQuery}`;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Performance</h3>
          <p className="text-sm text-muted-foreground">
            {range.label} — <strong>{t("0% sabse achha")}</strong>, {t("−100% sabse kharab.")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SendReportsButton rangeQuery={rangeQuery} />
          <Button variant="outline" size="sm" render={<Link href={exportHref}>Excel export</Link>} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartFrame
          title={t("Har user ka score")}
          hint={t("Bar jitna lamba, penalty utni zyada. Har bar par uska score likha hai.")}
        >
          <BarChart
            data={scored.map((r) => ({
              label: r.name,
              value: r.summary.score ?? 0,
              // Status colour, because this is a state (fine / slipping / bad), not identity.
              color:
                (r.summary.score ?? 0) >= -20
                  ? "var(--chart-good)"
                  : (r.summary.score ?? 0) >= -50
                    ? "var(--chart-warning)"
                    : "var(--chart-critical)",
            }))}
            valueSuffix="%"
            emptyMessage={t("Is period me kisi ka score evaluate nahi hua.")}
          />
        </ChartFrame>

        <ChartFrame title={t("Doer outcome breakdown")} hint={t("Evaluated task and FMS outcomes across the full team.")}>
          <SeriesChart rows={data.charts.map(r => ({ label: r.name, onTime: r.summary.onTime, delayed: r.summary.delay, overdue: r.summary.notDone }))}
            series={[{ key: "onTime", label: t("On Time"), color: "var(--chart-good)" }, { key: "delayed", label: t("Delay Done"), color: "var(--chart-warning)" }, { key: "overdue", label: t("Not Done"), color: "var(--chart-critical)" }]}
            unit={t("Evaluated outcomes")} stacked emptyMessage={t("Is period me kisi ka score evaluate nahi hua.")} />
        </ChartFrame>
      </div>

      {/* The table is the chart's accessible twin — same numbers, no colour needed. */}
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Department</TableHead>
              <TableHead className="text-center">On Time</TableHead>
              <TableHead className="text-center">Delay</TableHead>
              <TableHead className="text-center">Not Done</TableHead>
              <TableHead className="text-right">Score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{t("Koi active user nahi mila.")}</TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.userId}>
                <TableCell className="font-medium">
                  <DoerScoreDialog
                    name={r.name}
                    scoreLabel={formatScore(r.summary.score)}
                    scoreColorClass={getScoreColorClass(r.summary.score)}
                    exportHref={doerExportHref(r.userId)}
                  >
                    <div className="space-y-3">
                      <p>{t("Full score:")} {r.summary.penalty} {t("penalty")} / {r.summary.totalEvaluated} {t("evaluated")} = {formatScore(r.summary.score)}.</p>
                      <p className="text-sm text-muted-foreground">{t("Recent evaluated details only: up to 20 tasks and 20 FMS steps. Use Excel export for the complete breakdown.")}</p>
                      <Table>
                        <TableHeader><TableRow><TableHead>{t("Task / Step")}</TableHead><TableHead>{t("Result")}</TableHead><TableHead>{t("Penalty")}</TableHead></TableRow></TableHeader>
                        <TableBody>{computeMisBreakdown(tasks.filter(task => task.Assigned_To === r.userId), fmsRuns.filter(run => run.Assigned_To === r.userId)).map(detail => (
                          <TableRow key={detail.id}><TableCell>{detail.label}</TableCell><TableCell>{detail.outcome}</TableCell><TableCell>{detail.penalty} / {detail.evaluated}</TableCell></TableRow>
                        ))}</TableBody>
                      </Table>
                    </div>
                  </DoerScoreDialog>
                </TableCell>
                <TableCell>{r.role}</TableCell>
                <TableCell>{r.department || "—"}</TableCell>
                <TableCell className="text-center tabular-nums">{r.summary.onTime}</TableCell>
                <TableCell className="text-center tabular-nums">{r.summary.delay}</TableCell>
                <TableCell className="text-center tabular-nums">{r.summary.notDone}</TableCell>
                <TableCell
                  className={cn(
                    "text-right font-semibold tabular-nums",
                    getScoreColorClass(r.summary.score)
                  )}
                >
                  {formatScore(r.summary.score)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <form action={setPerf04PerformancePage.bind(null, rangeIdentity(range))} className="flex items-center justify-between gap-3">
        <button type="submit" name="page" value={Math.max(0, data.page - 1)} disabled={data.page === 0} className="rounded border px-3 py-2 disabled:opacity-50">{t("Previous page")}</button>
        <span className="text-sm text-muted-foreground">{t("Page")} {data.page + 1} — {t("up to 25 users; charts include the full team.")}</span>
        <button type="submit" name="page" value={data.page + 1} disabled={!data.hasMore} className="rounded border px-3 py-2 disabled:opacity-50">{t("Next page")}</button>
      </form>
    </section>
  );
}
