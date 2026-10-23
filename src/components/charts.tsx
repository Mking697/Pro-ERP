"use client";

import { cn } from "@/lib/utils";
import {
  Area,
  AreaChart,
  Line,
  LineChart,
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** Client-only visualization leaves; data reads, grants and tenant scope stay on the
 * server. All props are serializable. Existing Inventory detail calls remain valid.
 * Direct labels / bounded exact-value tables carry the same data without hover or
 * color, and remain usable before ResponsiveContainer measures the client layout. */

export interface Slice {
  label: string;
  value: number;
  /** A CSS colour — pass a var(--chart-*) token, not a raw hex. */
  color: string;
}

function EmptyChart({ message }: { message: string }) {
  return (
    <p className="py-10 text-center text-sm text-muted-foreground">{message}</p>
  );
}

/** Screen-reader-only text summary, replacing the old per-shape SVG <title> hovers. */
function SrSummary({ text }: { text: string }) {
  return <span className="sr-only">{text}</span>;
}

function Legend({ items, valueSuffix = "" }: { items: Slice[]; valueSuffix?: string }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-[2px]"
            style={{ background: item.color }}
          />
          {/* Text stays in ink, never the series colour. */}
          <span className="text-muted-foreground">{item.label}</span>
          <span className="font-medium tabular-nums">{item.value}{valueSuffix}</span>
        </li>
      ))}
    </ul>
  );
}

function BarTooltip({
  active,
  payload,
  valueSuffix,
}: {
  active?: boolean;
  payload?: Array<{ payload: Slice }>;
  valueSuffix: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border bg-card px-2.5 py-1.5 text-xs shadow-md">
      <p className="font-medium">{row.label}</p>
      <p className="tabular-nums text-muted-foreground">
        {row.value}
        {valueSuffix}
      </p>
    </div>
  );
}

/**
 * Horizontal bars — labels read left-to-right at any length, which vertical bars
 * cannot do without rotating text.
 */
export function BarChart({
  data,
  emptyMessage,
  valueSuffix = "",
  emptyWhenZero = false,
}: {
  data: Slice[];
  /** Required: the caller holds the translator, this file does not. */
  emptyMessage: string;
  valueSuffix?: string;
  /** Use for count distributions only; zero scores/stocks are legitimate values. */
  emptyWhenZero?: boolean;
}) {
  const rows = data.filter((d) => Number.isFinite(d.value));
  if (rows.length === 0 || (emptyWhenZero && rows.every(r => r.value === 0))) return <EmptyChart message={emptyMessage} />;

  const rowHeight = 32;
  const height = Math.max(rows.length * rowHeight, 64);

  return (
    <div>
      <SrSummary
        text={rows.map((r) => `${r.label}: ${r.value}${valueSuffix}`).join(", ")}
      />
      <div className="overflow-y-auto" style={{ maxHeight: 320 }}>
      <div style={{ height }} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <RBarChart
            data={rows}
            layout="vertical"
            margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
            barCategoryGap={8}
            accessibilityLayer={false}
          >
            <XAxis type="number" domain={[rows.reduce((min, row) => Math.min(min, row.value), 0), rows.reduce((max, row) => Math.max(max, row.value), 0)]} tick={{ fontSize: 10 }} />
            <YAxis
              type="category"
              dataKey="label"
              width={112}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 12, fill: "var(--muted-foreground)" }}
              tickFormatter={(label: string) =>
                label.length > 14 ? `${label.slice(0, 13)}…` : label
              }
            />
            <Tooltip
              cursor={{ fill: "var(--muted)" }}
              content={<BarTooltip valueSuffix={valueSuffix} />}
            />
            <Bar dataKey="value" radius={[4, 4, 4, 4]} maxBarSize={20} animationDuration={500}>
              {rows.map((row) => (
                <Cell key={row.label} fill={row.color} />
              ))}
            </Bar>
          </RBarChart>
        </ResponsiveContainer>
      </div>
      </div>
      <div className="max-h-40 overflow-y-auto"><Legend items={rows} valueSuffix={valueSuffix} /></div>
    </div>
  );
}

function DonutTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: Slice & { pct: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-md border bg-card px-2.5 py-1.5 text-xs shadow-md">
      <p className="font-medium">{row.label}</p>
      <p className="tabular-nums text-muted-foreground">
        {row.value} ({row.pct}%)
      </p>
    </div>
  );
}

/**
 * Donut for parts-of-a-whole. Capped at five slices by the caller — past that a bar
 * chart reads better, so anything longer should be folded into "Other" first.
 */
export function DonutChart({
  data,
  centerLabel,
  centerValue,
  emptyMessage,
}: {
  data: Slice[];
  centerLabel?: string;
  centerValue?: string;
  /** Required: the caller holds the translator, this file does not. */
  emptyMessage: string;
}) {
  const slices = data.filter((d) => d.value > 0);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return <EmptyChart message={emptyMessage} />;

  const withPct = slices.map((s) => ({ ...s, pct: Math.round((s.value / total) * 100) }));

  return (
    <div>
      <SrSummary text={slices.map((s) => `${s.label}: ${s.value}`).join(", ")} />
      <div className="relative flex justify-center" aria-hidden="true">
        <div className="h-40 w-40">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart accessibilityLayer={false}>
              <Pie
                data={withPct}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={70}
                paddingAngle={slices.length > 1 ? 2 : 0}
                startAngle={90}
                endAngle={-270}
                stroke="none"
                animationDuration={400}
              >
                {withPct.map((slice) => (
                  <Cell key={slice.label} fill={slice.color} />
                ))}
              </Pie>
              <Tooltip content={<DonutTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {(centerValue || centerLabel) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            {centerValue && (
              <span className="text-[20px] font-semibold tabular-nums text-foreground">
                {centerValue}
              </span>
            )}
            {centerLabel && (
              <span className="text-[9px] text-muted-foreground">{centerLabel}</span>
            )}
          </div>
        )}
      </div>
      <Legend items={slices} />
    </div>
  );
}

export interface TimelinePoint {
  /** Axis label, e.g. "12 Aug". */
  label: string;
  value: number;
}

/** Serializable multi-series chart, with an always-visible exact-value table.
 * The SVG is an enhancement; labels/data remain usable before client measurement. */
export function SeriesChart({ rows, series, unit, emptyMessage, stacked = false, kind = "column" }: {
  rows: Array<{ label: string; [key: string]: string | number | null }>;
  series: Array<{ key: string; label: string; color: string }>;
  unit: string;
  emptyMessage: string;
  stacked?: boolean;
  kind?: "column" | "line" | "area";
}) {
  const clean = rows.filter(row => series.every(s => row[s.key] === null || Number.isFinite(row[s.key])));
  if (!clean.length) return <EmptyChart message={emptyMessage} />;
  const axes = <>
    <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
    <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" tick={{ fontSize: 10 }} />
    <YAxis width={52} tick={{ fontSize: 10 }} />
    <Tooltip />
  </>;
  return <div className="min-w-0 space-y-3">
    {unit && <p className="text-xs text-muted-foreground">{unit}</p>}
    <div className="h-52 w-full min-w-0" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        {kind === "column" ? <RBarChart data={clean} accessibilityLayer={false}>
          {axes}{series.map(s => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} stackId={stacked ? "total" : undefined} maxBarSize={32} isAnimationActive={false} />)}
        </RBarChart> : kind === "line" ? <LineChart data={clean} accessibilityLayer={false}>
          {axes}{series.map(s => <Line key={s.key} dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} connectNulls={false} isAnimationActive={false} />)}
        </LineChart> : <AreaChart data={clean} accessibilityLayer={false}>
          {axes}{series.map(s => <Area key={s.key} dataKey={s.key} name={s.label} stroke={s.color} fill={s.color} fillOpacity={0.15} isAnimationActive={false} />)}
        </AreaChart>}
      </ResponsiveContainer>
    </div>
    <ul className="flex flex-wrap gap-3 text-xs">{series.filter(s => s.label).map(s => <li key={s.key} className="flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</li>)}</ul>
    <div className="max-h-40 overflow-auto rounded border">
      <table className="w-full text-xs tabular-nums">
        <caption className="sr-only">{unit}</caption>
        <thead><tr><th scope="col" className="p-2 text-left">{unit}</th>{series.map(s => <th scope="col" className="p-2 text-right" key={s.key}>{s.label}</th>)}</tr></thead>
        <tbody>{clean.map((row, i) => <tr key={`${row.label}-${i}`}><th scope="row" className="p-2 text-left font-normal">{row.label}</th>{series.map(s => <td key={s.key} className="p-2 text-right">{row[s.key] ?? "—"}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </div>;
}

/** Existing callers remain valid; report callers supply a visible translated series/unit. */
export function TimelineChart({ points, color = "var(--chart-series-1)", emptyMessage, valueSuffix = "", seriesLabel = "", kind = "area" }: {
  points: TimelinePoint[];
  color?: string;
  emptyMessage: string;
  valueSuffix?: string;
  seriesLabel?: string;
  kind?: "column" | "line" | "area";
}) {
  const clean = points.filter(p => Number.isFinite(p.value));
  if (!clean.length) return <EmptyChart message={emptyMessage} />;
  return <div>
    <SrSummary text={clean.map(p => `${p.label}: ${p.value}${valueSuffix}`).join(", ")} />
    <SeriesChart rows={clean.map(p => ({ ...p }))} series={[{ key: "value", label: seriesLabel || valueSuffix, color }]} unit={valueSuffix.trim()} emptyMessage={emptyMessage} kind={kind} />
  </div>;
}

/** Wraps a chart with its title, so every card on the page has the same anatomy. */
export function ChartFrame({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 rounded-xl border bg-card p-4 shadow-sm transition-shadow duration-200 hover:shadow-md", className)}>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}
