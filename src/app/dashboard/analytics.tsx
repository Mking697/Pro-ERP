import Link from "next/link";
import type { SessionPayload } from "@/lib/auth/session";
import { tryModule } from "@/lib/moduleSheets";
import { listTasks, type TaskRecord } from "@/lib/tasks";
import { listUsers } from "@/lib/auth/users";
import { listRecurringTasks } from "@/lib/recurringTasks";
import { listInwardEntries, listFailureLog, listImsInward } from "@/lib/inward";
import { getFrequencyLabel } from "@/lib/frequency";
import { formatScore, getScoreColorClass } from "@/lib/mis";
import {
  RANGE_PRESETS,
  resolveRange,
  filterTasks,
  inRange,
  bucketByDate,
  countBy,
  perUserScores,
  taskTotals,
  type DateRange,
} from "@/lib/analytics";
import { BarChart, DonutChart, TimelineChart, ChartFrame } from "@/components/charts";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import DateRangeFilter from "./date-range-filter";
import { getT } from "@/lib/i18n/server";
import type { Translator } from "@/lib/i18n";
import { getInventorySnapshot, itemsNeedingReorder } from "@/lib/inventory/service";
import { listIndents } from "@/lib/inventory/indents";
import { listBoms } from "@/lib/inventory/bom";
import { listPlans } from "@/lib/inventory/plans";
import { tenantCached } from "@/lib/cache";
import { canSeeReport, getReport } from "@/lib/reports";
import { runWithTenant, type TenantContext } from "@/lib/tenant";

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

  // Only read the sheets this viewer is actually allowed to see — every extra read
  // spends the shared Sheets quota for no one's benefit.
  //
  // Cached briefly, per organization. Reports now span ten modules, so one render can
  // fire well over a dozen sheet reads, and a public share link puts that behind a URL
  // anybody may refresh. A chart covering a date range is not stock on a shelf: half a
  // minute of staleness costs a reader nothing, where an out-of-date free-stock figure
  // would let two people promise the same material. That is why this caches and the
  // inventory screens do not.
  //
  // Each read degrades to null on its own rather than throwing, so one exhausted quota
  // or one disconnected sheet leaves the rest of the report standing.
  const read = () =>
    tenantCached(session.orgId, `analytics:${only ?? "all"}:${range.key}:${from ?? ""}:${to ?? ""}:${access.join(",")}`, 30_000, () =>
      Promise.all([
        needs("tasks") || needs("delegation") || needs("performance")
          ? safe(() => tryModule(() => listTasks()))
          : null,
        needs("performance") || needs("delegation")
          ? listUsers().catch(() => [])
          : Promise.resolve([]),
        needs("recurring") ? safe(() => tryModule(() => listRecurringTasks())) : null,
        needs("inward") ? safe(() => tryModule(() => listInwardEntries())) : null,
        needs("iqc") ? safe(() => tryModule(() => listFailureLog())) : null,
        needs("iqc") || needs("ims")
          ? safe(() => tryModule(() => listImsInward()))
          : null,
        needs("inventory") ? safe(() => getInventorySnapshot()) : null,
        needs("indents") ? safe(() => tryModule(() => listIndents())) : null,
        needs("bom") ? safe(() => tryModule(() => listBoms())) : null,
        needs("ppc") ? safe(() => tryModule(() => listPlans())) : null,
      ])
    );

  const [allTasks, users, rules, inward, failures, ims, stock, indents, boms, plans] =
    tenant ? await runWithTenant(tenant, read) : await read();


  const tasks = filterTasks(allTasks ?? [], range);
  const myTasks = tasks.filter((t) => t.Assigned_To === session.userId);
  const totals = taskTotals(myTasks);

  const outcomeSlices = [
    { label: "On Time", value: totals.onTime, color: "var(--chart-good)" },
    { label: "Delay Done", value: totals.delay, color: "var(--chart-warning)" },
    { label: "Not Done", value: totals.overdue, color: "var(--chart-critical)" },
  ];

  return (
    <div className="space-y-8">
      {!hideFilter && (
        <DateRangeFilter active={range} presets={RANGE_PRESETS} from={from} to={to} />
      )}

      {shows("tasks") && (
      <Section
        title={t("Mera kaam")}
        description={`${range.label} — aapko assign hue tasks.`}
      >
        <ChartFrame
          title={t("Result ka batwara")}
          hint={t("Har rang ke saath uski ginti bhi likhi hai — sirf rang par nahi jaana padta.")}
        >
          <DonutChart
            data={outcomeSlices}
            centerValue={String(totals.onTime + totals.delay + totals.overdue)}
            centerLabel="evaluated"
            emptyMessage={t("Is period me koi task evaluate nahi hua.")}
          />
        </ChartFrame>

        <ChartFrame title={t("Tasks kab bane")} hint={t("Aapko assign hue tasks, samay ke saath.")}>
          <TimelineChart
            points={bucketByDate(myTasks.map((task) => task.Created_At), range)}
            emptyMessage={t("Is period me koi data nahi.")}
          />
        </ChartFrame>
      </Section>
      )}

      {shows("delegation") && (
        <Section
          title="Delegation"
          description={t("Jo tasks aapne doosron ko diye.")}
        >
          <ChartFrame title={t("Kisko kitne tasks diye")}>
            <BarChart
              data={countBy(
                tasks.filter((t) => t.Assigned_By === session.userId),
                (t) => users.find((u) => u.User_ID === t.Assigned_To)?.Full_Name ?? t.Assigned_To
              ).map((b, i) => ({ ...b, color: seriesColor(i) }))}
              emptyMessage={t("Is period me aapne koi task assign nahi kiya.")}
            />
          </ChartFrame>

          <ChartFrame title={t("Priority ke hisaab se")}>
            <BarChart
              data={countBy(
                tasks.filter((t) => t.Assigned_By === session.userId),
                (t) => t.Priority
              ).map((b, i) => ({ ...b, color: seriesColor(i) }))}
              emptyMessage={t("Is period me aapne koi task assign nahi kiya.")}
            />
          </ChartFrame>
        </Section>
      )}

      {shows("recurring") && (
        <Section title="Recurring" description={t("Repeating rules aur unki haalat.")}>
          <ChartFrame title={t("Active vs Paused")}>
            <DonutChart
              data={[
                {
                  label: "Active",
                  value: (rules ?? []).filter((r) => r.Status === "Active").length,
                  color: "var(--chart-good)",
                },
                {
                  label: "Paused",
                  value: (rules ?? []).filter((r) => r.Status !== "Active").length,
                  color: "var(--chart-warning)",
                },
              ]}
              centerValue={String((rules ?? []).length)}
              centerLabel="rules"
              emptyMessage={t("Koi recurring rule nahi hai.")}
            />
          </ChartFrame>

          <ChartFrame title={t("Frequency ke hisaab se")}>
            <BarChart
              data={countBy(rules ?? [], (r) => getFrequencyLabel(r.Frequency)).map(
                (b, i) => ({ ...b, color: seriesColor(i) })
              )}
              emptyMessage={t("Koi recurring rule nahi hai.")}
            />
          </ChartFrame>
        </Section>
      )}

      {shows("inward") && inward && (
        <Section title="Inward" description={`${range.label} — material inward entries.`}>
          <ChartFrame title="IQC status">
            <DonutChart
              data={[
                {
                  label: "Verified",
                  value: inward.filter(
                    (e) => e.IQC_Status === "Verified" && inRange(e.Timestamp, range)
                  ).length,
                  color: "var(--chart-good)",
                },
                {
                  label: "Pending",
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
          <ChartFrame
            title={t("Pass vs Fail quantity")}
            hint={t("Quantity, entries ki ginti nahi.")}
          >
            <DonutChart
              data={[
                {
                  label: "Pass",
                  value: ims
                    .filter((r) => inRange(r.Timestamp, range))
                    .reduce((n, r) => n + Number(r.Pass_Qty || 0), 0),
                  color: "var(--chart-good)",
                },
                {
                  label: "Fail",
                  value: failures
                    .filter((r) => inRange(r.Timestamp, range))
                    .reduce((n, r) => n + Number(r.Fail_Qty || 0), 0),
                  color: "var(--chart-critical)",
                },
              ]}
              emptyMessage={t("Is period me koi quality check nahi hua.")}
            />
          </ChartFrame>

          <ChartFrame title={t("Rejection ke kaaran")}>
            <BarChart
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
          <ChartFrame title={t("Party ke hisaab se accepted qty")}>
            <BarChart
              data={countBy(
                ims.filter((r) => inRange(r.Timestamp, range)),
                (r) => r.Party_Name
              ).map((b, i) => ({ ...b, color: seriesColor(i) }))}
              valueSuffix=" entry"
              emptyMessage={t("Is period me koi verified stock nahi.")}
            />
          </ChartFrame>

          <ChartFrame title={t("Stock kab aaya")}>
            <TimelineChart
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

      {shows("inventory") && stock && stock.items.length > 0 && (
        <Section
          title={t("Inventory")}
          description={t("Aaj ka stock — ye period filter par nahi badalta.")}
        >
          <ChartFrame
            title={t("Stock status")}
            hint={t("Free stock ko reorder point se tolkar.")}
          >
            <DonutChart
              data={[
                { label: "Healthy", value: statusCount(stock.items, "Healthy"), color: "var(--chart-good)" },
                { label: "Low", value: statusCount(stock.items, "Low"), color: "var(--chart-warning)" },
                { label: "Critical", value: statusCount(stock.items, "Critical"), color: "var(--chart-critical)" },
                { label: "Out of Stock", value: statusCount(stock.items, "Out of Stock"), color: "var(--chart-critical)" },
                { label: "Not Set Up", value: statusCount(stock.items, "Not Set Up"), color: "var(--chart-axis)" },
              ]}
              emptyMessage={t("Abhi koi item nahi hai.")}
            />
          </ChartFrame>

          <ChartFrame
            title={t("Reorder point se sabse neeche")}
            hint={t("Jo apne reorder point se sabse zyada neeche gir chuka hai.")}
          >
            <BarChart
              data={itemsNeedingReorder(stock.items)
                .slice(0, 8)
                .map((i) => ({
                  label: i.item.Item_Name || i.item.SKU,
                  value: Math.round((i.rop ?? 0) - i.projected),
                  color: "var(--chart-critical)",
                }))}
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
            <DonutChart
              data={countBy(
                indents.filter((i) => inRange(i.Timestamp, range)),
                (i) => i.Status
              ).map((b, idx) => ({ ...b, color: seriesColor(idx) }))}
              emptyMessage={t("Is period me koi indent nahi.")}
            />
          </ChartFrame>

          <ChartFrame title={t("Indents kab bane")}>
            <TimelineChart
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
            hint={t("Sirf active version ginti me hai.")}
          >
            <BarChart
              data={boms
                .filter((b) => b.status === "Active")
                .slice(0, 10)
                .map((b, idx) => ({
                  label: b.productName,
                  value: b.lines.length,
                  color: seriesColor(idx),
                }))}
              emptyMessage={t("Abhi koi BOM nahi hai")}
            />
          </ChartFrame>

          <ChartFrame title={t("Active vs Archived")}>
            <DonutChart
              data={[
                {
                  label: "Active",
                  value: boms.filter((b) => b.status === "Active").length,
                  color: "var(--chart-good)",
                },
                {
                  label: "Archived",
                  value: boms.filter((b) => b.status !== "Active").length,
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
          <ChartFrame title={t("Plan status")}>
            <DonutChart
              data={[
                { label: "Ready", value: planCount(plans, range, "Ready"), color: "var(--chart-good)" },
                { label: "Shortage", value: planCount(plans, range, "Shortage"), color: "var(--chart-critical)" },
                { label: "In Production", value: planCount(plans, range, "In_Production"), color: "var(--chart-series-1)" },
                { label: "Completed", value: planCount(plans, range, "Completed"), color: "var(--chart-series-3)" },
                { label: "Cancelled", value: planCount(plans, range, "Cancelled"), color: "var(--chart-axis)" },
              ]}
              emptyMessage={t("Is period me koi plan nahi bana.")}
            />
          </ChartFrame>

          <ChartFrame
            title={t("Production kab honi hai")}
            hint={t("Plan ki production date ke hisaab se.")}
          >
            <TimelineChart
              emptyMessage={t("Is period me koi plan nahi bana.")}
              points={bucketByDate(
                plans.filter((p) => inRange(p.timestamp, range)).map((p) => p.productionDate),
                range
              )}
            />
          </ChartFrame>
        </Section>
      )}

      {shows("performance") && (
        <PerformanceSection tasks={tasks} users={users} range={range} t={t} />
      )}
    </div>
  );
}

function PerformanceSection({
  tasks,
  users,
  range,
  t,
}: {
  tasks: TaskRecord[];
  users: Awaited<ReturnType<typeof listUsers>>;
  range: DateRange;
  /** Passed down: this is a plain function, so it cannot await the request's locale. */
  t: Translator;
}) {
  const rows = perUserScores(users, tasks);
  const scored = rows.filter((r) => r.summary.score !== null);

  const exportHref = `/api/analytics/export?range=${range.key}${
    range.key === "custom"
      ? `&from=${range.from.toISOString().slice(0, 10)}&to=${range.to.toISOString().slice(0, 10)}`
      : ""
  }`;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold tracking-tight">Performance</h3>
          <p className="text-sm text-muted-foreground">
            {range.label} — <strong>0% sabse achha</strong>, −100% sabse kharab.
          </p>
        </div>
        <Button variant="outline" size="sm" render={<Link href={exportHref}>Excel export</Link>} />
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

        <ChartFrame title={t("Team ka batwara")} hint={t("Kitne log kis haalat me hain.")}>
          <DonutChart
            data={[
              {
                label: "Theek (0 se −20%)",
                value: scored.filter((r) => (r.summary.score ?? 0) >= -20).length,
                color: "var(--chart-good)",
              },
              {
                label: "Dhyan dein (−21 se −50%)",
                value: scored.filter(
                  (r) => (r.summary.score ?? 0) < -20 && (r.summary.score ?? 0) >= -50
                ).length,
                color: "var(--chart-warning)",
              },
              {
                label: "Kharab (−50% se neeche)",
                value: scored.filter((r) => (r.summary.score ?? 0) < -50).length,
                color: "var(--chart-critical)",
              },
            ]}
            centerValue={String(scored.length)}
            centerLabel="users"
            emptyMessage={t("Is period me kisi ka score evaluate nahi hua.")}
          />
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
                <TableCell className="font-medium">{r.name}</TableCell>
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
    </section>
  );
}
