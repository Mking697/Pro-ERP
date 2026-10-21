"use client";

import { cn } from "@/lib/utils";
import {
  Area,
  AreaChart,
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

/**
 * Recharts-based dashboard charts.
 *
 * These were hand-rolled SVG for a long time (server-rendered, zero client JS) because
 * three simple chart forms didn't seem worth a library. The team decided the premium,
 * polished look a real charting library gives (smooth tooltips, consistent animation,
 * proper hit-testing) is worth it even though it means this module — and every page
 * that renders it — now ships client JS instead of staying server-rendered. That is a
 * deliberate, approved tradeoff, not an oversight: these components were always leaves
 * in the tree (no children composition that needs to stay server-side), so making them
 * client components costs bundle size but nothing else in the app's architecture.
 *
 * The exported API (prop names and shapes) is unchanged from the SVG version on purpose,
 * so callers (dashboard/analytics.tsx, inventory/[sku]/page.tsx) needed zero edits: they
 * still render these as ordinary JSX from server components, which Next.js allows as
 * long as the props crossing the boundary are serializable — which Slice[]/TimelinePoint[]
 * always were.
 *
 * Every chart here carries direct labels and, for more than one series, a legend. That
 * is not decoration: the status palette's warning step sits below 3:1 on a light
 * surface by design, so colour is never allowed to be the only thing distinguishing a
 * value. Recharts' tooltips replace the old SVG <title> hover text; each chart also
 * keeps an sr-only text summary so the same information that used to be announced via
 * <title> is still available to screen readers even though Recharts' own internal SVG
 * nodes aren't natively announced the way <title> was. This is the closest achievable
 * parity: Recharts has no per-shape accessible-name equivalent to SVG <title>, so a
 * sr-only text block carries that job instead; the visual chart is marked aria-hidden
 * so the two descriptions are not read twice.
 */

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

function Legend({ items }: { items: Slice[] }) {
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
          <span className="font-medium tabular-nums">{item.value}</span>
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
}: {
  data: Slice[];
  /** Required: the caller holds the translator, this file does not. */
  emptyMessage: string;
  valueSuffix?: string;
}) {
  const rows = data.filter((d) => Number.isFinite(d.value));
  if (rows.length === 0) return <EmptyChart message={emptyMessage} />;

  const rowHeight = 32;
  const height = Math.max(rows.length * rowHeight, 64);

  return (
    <div>
      <SrSummary
        text={rows.map((r) => `${r.label}: ${r.value}${valueSuffix}`).join(", ")}
      />
      <div style={{ height }} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <RBarChart
            data={rows}
            layout="vertical"
            margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
            barCategoryGap={8}
            accessibilityLayer={false}
          >
            <XAxis type="number" hide domain={[0, "auto"]} />
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

function TimelineTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: TimelinePoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-md border bg-card px-2.5 py-1.5 text-xs shadow-md">
      <p className="font-medium">{point.label}</p>
      <p className="tabular-nums text-muted-foreground">{point.value}</p>
    </div>
  );
}

/** Change over time. One series, so it needs no legend — the card title names it. */
export function TimelineChart({
  points,
  color = "var(--chart-series-1)",
  emptyMessage,
}: {
  points: TimelinePoint[];
  color?: string;
  /** Required: the caller holds the translator, this file does not. */
  emptyMessage: string;
}) {
  if (points.length === 0) return <EmptyChart message={emptyMessage} />;

  // Gradient ids must be unique per page when more than one timeline chart renders at
  // once; derived from the data itself so two charts with different data/colors on the
  // same page never collide.
  const gradientId = `timeline-fill-${color.replace(/[^a-zA-Z0-9]/g, "")}-${points[0].label.replace(/[^a-zA-Z0-9]/g, "")}-${points.length}`;

  // At most six labels, so ticks never collide on a narrow card.
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <div>
      <SrSummary
        text={`Timeline: ${points.map((p) => `${p.label} ${p.value}`).join(", ")}`}
      />
      <div className="h-40 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={points}
            margin={{ top: 12, right: 8, bottom: 0, left: 0 }}
            accessibilityLayer={false}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval={labelEvery - 1}
              tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
            />
            <YAxis hide domain={[0, "auto"]} />
            <Tooltip content={<TimelineTooltip />} cursor={{ stroke: "var(--chart-grid)" }} />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2.5}
              fill={`url(#${gradientId})`}
              dot={{ r: 4, fill: "var(--card)", stroke: color, strokeWidth: 2.5 }}
              activeDot={{ r: 5 }}
              animationDuration={500}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
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
    <div className={cn("rounded-xl border bg-card p-4 shadow-sm transition-shadow duration-200 hover:shadow-md", className)}>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}
