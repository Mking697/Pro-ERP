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

const SERIES = [
  "var(--chart-series-1)",
  "var(--chart-series-2)",
  "var(--chart-series-3)",
] as const;

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
}: {
  session: SessionPayload;
  rangeKey: string;
  from?: string;
  to?: string;
}) {
  const range = resolveRange(rangeKey, from, to);
  const access = session.access;

  // Only read the sheets this viewer is actually allowed to see — every extra read
  // spends the shared Sheets quota for no one's benefit.
  const [allTasks, users, rules, inward, failures, ims] = await Promise.all([
    tryModule(() => listTasks()),
    access.includes("PERFORMANCE_VIEW") || access.includes("TASK_DELEGATE")
      ? listUsers().catch(() => [])
      : Promise.resolve([]),
    access.includes("RECURRING_ASSIGN") ? tryModule(() => listRecurringTasks()) : null,
    access.includes("INWARD_ENTRY") || access.includes("IQC_CHECK") || access.includes("IMS_VIEW")
      ? tryModule(() => listInwardEntries())
      : null,
    access.includes("IMS_VIEW") ? tryModule(() => listFailureLog()) : null,
    access.includes("IMS_VIEW") ? tryModule(() => listImsInward()) : null,
  ]);

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
      <DateRangeFilter active={range} presets={RANGE_PRESETS} from={from} to={to} />

      <Section
        title="Mera kaam"
        description={`${range.label} — aapko assign hue tasks.`}
      >
        <ChartFrame
          title="Result ka batwara"
          hint="Har rang ke saath uski ginti bhi likhi hai — sirf rang par nahi jaana padta."
        >
          <DonutChart
            data={outcomeSlices}
            centerValue={String(totals.onTime + totals.delay + totals.overdue)}
            centerLabel="evaluated"
            emptyMessage="Is period me koi task evaluate nahi hua."
          />
        </ChartFrame>

        <ChartFrame title="Tasks kab bane" hint="Aapko assign hue tasks, samay ke saath.">
          <TimelineChart points={bucketByDate(myTasks.map((t) => t.Created_At), range)} />
        </ChartFrame>
      </Section>

      {access.includes("TASK_DELEGATE") && (
        <Section
          title="Delegation"
          description="Jo tasks aapne doosron ko diye."
        >
          <ChartFrame title="Kisko kitne tasks diye">
            <BarChart
              data={countBy(
                tasks.filter((t) => t.Assigned_By === session.userId),
                (t) => users.find((u) => u.User_ID === t.Assigned_To)?.Full_Name ?? t.Assigned_To
              ).map((b, i) => ({ ...b, color: seriesColor(i) }))}
              emptyMessage="Is period me aapne koi task assign nahi kiya."
            />
          </ChartFrame>

          <ChartFrame title="Priority ke hisaab se">
            <BarChart
              data={countBy(
                tasks.filter((t) => t.Assigned_By === session.userId),
                (t) => t.Priority
              ).map((b, i) => ({ ...b, color: seriesColor(i) }))}
              emptyMessage="Is period me aapne koi task assign nahi kiya."
            />
          </ChartFrame>
        </Section>
      )}

      {access.includes("RECURRING_ASSIGN") && (
        <Section title="Recurring" description="Repeating rules aur unki haalat.">
          <ChartFrame title="Active vs Paused">
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
              emptyMessage="Koi recurring rule nahi hai."
            />
          </ChartFrame>

          <ChartFrame title="Frequency ke hisaab se">
            <BarChart
              data={countBy(rules ?? [], (r) => getFrequencyLabel(r.Frequency)).map(
                (b, i) => ({ ...b, color: seriesColor(i) })
              )}
              emptyMessage="Koi recurring rule nahi hai."
            />
          </ChartFrame>
        </Section>
      )}

      {inward && (
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
              emptyMessage="Is period me koi inward entry nahi."
            />
          </ChartFrame>

          <ChartFrame title="Entries kab aayi">
            <TimelineChart
              points={bucketByDate(
                inward.filter((e) => inRange(e.Timestamp, range)).map((e) => e.Timestamp),
                range
              )}
            />
          </ChartFrame>
        </Section>
      )}

      {access.includes("IQC_CHECK") && failures && ims && (
        <Section title="IQC" description="Quality check ka nateeja.">
          <ChartFrame
            title="Pass vs Fail quantity"
            hint="Quantity, entries ki ginti nahi."
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
              emptyMessage="Is period me koi quality check nahi hua."
            />
          </ChartFrame>

          <ChartFrame title="Rejection ke kaaran">
            <BarChart
              data={countBy(
                failures.filter((r) => inRange(r.Timestamp, range)),
                (r) => r.Fail_Reason
              ).map((b) => ({ ...b, color: "var(--chart-critical)" }))}
              emptyMessage="Koi rejection nahi — achhi baat hai."
            />
          </ChartFrame>
        </Section>
      )}

      {access.includes("IMS_VIEW") && ims && (
        <Section title="IMS" description="Verified stock jo andar aaya.">
          <ChartFrame title="Party ke hisaab se accepted qty">
            <BarChart
              data={countBy(
                ims.filter((r) => inRange(r.Timestamp, range)),
                (r) => r.Party_Name
              ).map((b, i) => ({ ...b, color: seriesColor(i) }))}
              valueSuffix=" entry"
              emptyMessage="Is period me koi verified stock nahi."
            />
          </ChartFrame>

          <ChartFrame title="Stock kab aaya">
            <TimelineChart
              points={bucketByDate(
                ims.filter((r) => inRange(r.Timestamp, range)).map((r) => r.Timestamp),
                range
              )}
              color="var(--chart-series-3)"
            />
          </ChartFrame>
        </Section>
      )}

      {access.includes("PERFORMANCE_VIEW") && (
        <PerformanceSection tasks={tasks} users={users} range={range} />
      )}
    </div>
  );
}

function PerformanceSection({
  tasks,
  users,
  range,
}: {
  tasks: TaskRecord[];
  users: Awaited<ReturnType<typeof listUsers>>;
  range: DateRange;
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
          title="Har user ka score"
          hint="Bar jitna lamba, penalty utni zyada. Har bar par uska score likha hai."
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
            emptyMessage="Is period me kisi ka score evaluate nahi hua."
          />
        </ChartFrame>

        <ChartFrame title="Team ka batwara" hint="Kitne log kis haalat me hain.">
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
            emptyMessage="Is period me kisi ka score evaluate nahi hua."
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
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  Koi active user nahi mila.
                </TableCell>
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
