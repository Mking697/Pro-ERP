import { cn } from "@/lib/utils";

/**
 * Hand-rolled SVG charts.
 *
 * No charting library: these three forms are simple enough to draw directly, and doing
 * so keeps them server-rendered with no client bundle — which matters on a dashboard
 * that shows six of them at once.
 *
 * Every chart here carries direct labels and, for more than one series, a legend. That
 * is not decoration: the status palette's warning step sits below 3:1 on a light
 * surface by design, so colour is never allowed to be the only thing distinguishing a
 * value. Tooltips use SVG <title>, which the browser reads natively and screen readers
 * announce, so hover works without shipping JavaScript.
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

/**
 * Horizontal bars — labels read left-to-right at any length, which vertical bars
 * cannot do without rotating text.
 */
export function BarChart({
  data,
  emptyMessage = "Abhi koi data nahi.",
  valueSuffix = "",
}: {
  data: Slice[];
  emptyMessage?: string;
  valueSuffix?: string;
}) {
  const rows = data.filter((d) => Number.isFinite(d.value));
  if (rows.length === 0) return <EmptyChart message={emptyMessage} />;

  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1);

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const pct = (Math.abs(row.value) / max) * 100;
        return (
          <div key={row.label} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3">
            <span className="truncate text-xs text-muted-foreground" title={row.label}>
              {row.label}
            </span>
            <div className="h-5 overflow-hidden rounded-[4px] bg-muted">
              <div
                className="h-full rounded-[4px]"
                style={{ width: `${Math.max(pct, 1.5)}%`, background: row.color }}
                title={`${row.label}: ${row.value}${valueSuffix}`}
              />
            </div>
            <span className="w-12 text-right text-xs font-medium tabular-nums">
              {row.value}
              {valueSuffix}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function arc(cx: number, cy: number, r: number, from: number, to: number): string {
  const p = (angle: number) => {
    const rad = ((angle - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
  };
  const [x1, y1] = p(from);
  const [x2, y2] = p(to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

/**
 * Donut for parts-of-a-whole. Capped at five slices by the caller — past that a bar
 * chart reads better, so anything longer should be folded into "Other" first.
 */
export function DonutChart({
  data,
  centerLabel,
  centerValue,
  emptyMessage = "Abhi koi data nahi.",
}: {
  data: Slice[];
  centerLabel?: string;
  centerValue?: string;
  emptyMessage?: string;
}) {
  const slices = data.filter((d) => d.value > 0);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (total === 0) return <EmptyChart message={emptyMessage} />;

  const size = 160;
  const cx = size / 2;
  const cy = size / 2;
  const r = 62;
  const stroke = 22;

  // Angles resolved up front, without mutating anything: a slice's start is just the
  // sum of the sweeps before it. At most five slices, so the repeated sum costs nothing.
  const gap = slices.length > 1 ? 1.5 : 0;
  const sweeps = slices.map((s) => (s.value / total) * 360);
  const segments = slices.map((slice, i) => {
    const start = sweeps.slice(0, i).reduce((a, b) => a + b, 0);
    const from = start + gap / 2;
    return {
      slice,
      from,
      to: Math.max(start + sweeps[i] - gap / 2, from + 0.5),
      pct: Math.round((slice.value / total) * 100),
    };
  });

  return (
    <div>
      <div className="flex justify-center">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          className="h-40 w-40"
          role="img"
          aria-label={slices
            .map((s) => `${s.label}: ${s.value}`)
            .join(", ")}
        >
          {segments.map(({ slice, from, to, pct }) =>
            // A single full-circle slice cannot be drawn as an arc.
            segments.length === 1 ? (
              <circle
                key={slice.label}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={slice.color}
                strokeWidth={stroke}
              >
                <title>{`${slice.label}: ${slice.value}`}</title>
              </circle>
            ) : (
              <path
                key={slice.label}
                d={arc(cx, cy, r, from, to)}
                fill="none"
                stroke={slice.color}
                strokeWidth={stroke}
                strokeLinecap="butt"
              >
                <title>{`${slice.label}: ${slice.value} (${pct}%)`}</title>
              </path>
            )
          )}

          {centerValue && (
            <text
              x={cx}
              y={cy - 2}
              textAnchor="middle"
              className="fill-foreground text-[20px] font-semibold"
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {centerValue}
            </text>
          )}
          {centerLabel && (
            <text
              x={cx}
              y={cy + 15}
              textAnchor="middle"
              className="fill-muted-foreground text-[9px]"
            >
              {centerLabel}
            </text>
          )}
        </svg>
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

/** Change over time. One series, so it needs no legend — the card title names it. */
export function TimelineChart({
  points,
  color = "var(--chart-series-1)",
  emptyMessage = "Is period me koi data nahi.",
}: {
  points: TimelinePoint[];
  color?: string;
  emptyMessage?: string;
}) {
  if (points.length === 0) return <EmptyChart message={emptyMessage} />;

  const w = 560;
  const h = 160;
  const pad = { top: 12, right: 8, bottom: 24, left: 28 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const max = Math.max(...points.map((p) => p.value), 1);
  const stepX = points.length > 1 ? plotW / (points.length - 1) : 0;

  const xy = points.map((p, i) => ({
    x: pad.left + (points.length > 1 ? i * stepX : plotW / 2),
    y: pad.top + plotH - (p.value / max) * plotH,
    ...p,
  }));

  const line = xy.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const area = `${line} L ${xy[xy.length - 1].x} ${pad.top + plotH} L ${xy[0].x} ${pad.top + plotH} Z`;

  // At most six labels, so ticks never collide on a narrow card.
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-40 w-full"
      role="img"
      aria-label={`Timeline: ${points.map((p) => `${p.label} ${p.value}`).join(", ")}`}
    >
      {[0, 0.5, 1].map((f) => (
        <line
          key={f}
          x1={pad.left}
          x2={w - pad.right}
          y1={pad.top + plotH * f}
          y2={pad.top + plotH * f}
          stroke="var(--chart-grid)"
          strokeWidth={1}
        />
      ))}

      <text x={2} y={pad.top + 4} className="fill-muted-foreground text-[9px]">
        {max}
      </text>
      <text x={2} y={pad.top + plotH + 3} className="fill-muted-foreground text-[9px]">
        0
      </text>

      <path d={area} fill={color} opacity={0.12} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />

      {xy.map((p) => (
        <circle key={p.label} cx={p.x} cy={p.y} r={4} fill={color}>
          <title>{`${p.label}: ${p.value}`}</title>
        </circle>
      ))}

      {xy.map((p, i) =>
        i % labelEvery === 0 || i === xy.length - 1 ? (
          <text
            key={`l-${p.label}`}
            x={p.x}
            y={h - 6}
            textAnchor="middle"
            className="fill-muted-foreground text-[9px]"
          >
            {p.label}
          </text>
        ) : null
      )}
    </svg>
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
    <div className={cn("rounded-lg border p-4", className)}>
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}
