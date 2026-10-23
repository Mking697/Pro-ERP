import React from "react";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { BarChart, SeriesChart, TimelineChart } from "@/components/charts";
import { XAxis } from "recharts";

const { parseNumericalUserDomain } = createRequire(import.meta.url)("recharts/lib/util/isDomainSpecifiedByUser.js");
function axisDomain(values: number[]) {
  const tree = BarChart({ data: values.map((value, i) => ({ label: String(i), value, color: "var(--chart-series-1)" })), emptyMessage: "Empty" });
  function find(node: React.ReactNode): unknown {
    if (Array.isArray(node)) return node.map(find).find(Boolean);
    if (!React.isValidElement<{ domain?: unknown; children?: React.ReactNode }>(node)) return undefined;
    return node.type === XAxis ? node.props.domain : find(node.props.children);
  }
  return find(tree);
}
it.each([
  { values: [90, 100], expected: [0, 100] },
  { values: [-100, -80], expected: [-100, 0] },
  { values: [-35, 90], expected: [-35, 90] },
])("bars use a numeric zero-inclusive domain for $values", ({ values, expected }) => {
  const domain = axisDomain(values);
  expect(domain).toEqual(expected);
  // Exercise the installed Recharts domain resolver, not SSR legend text.
  expect(parseNumericalUserDomain(domain, [Math.min(...values), Math.max(...values)], false)).toEqual(expected);
});

it("keeps existing BarChart calls compatible and exposes exact values visibly, not only hover/color", () => {
  const html = renderToStaticMarkup(<BarChart data={[{ label: "Penalty", value: -35, color: "var(--chart-critical)" }]} emptyMessage="Empty" valueSuffix="%" />);
  expect(html).toContain("<ul");
  expect(html).toContain("-35%");
  expect(html).not.toContain("NaN");
});
it("keeps long comparison charts bounded with scrolling rather than growing the dashboard", () => {
  const html = renderToStaticMarkup(<BarChart data={Array.from({ length: 40 }, (_, n) => ({ label: `SKU-${n}`, value: n, color: "var(--chart-series-1)" }))} emptyMessage="Empty" />);
  expect(html).toContain("max-height:320px");
  expect(html).toContain("overflow-y-auto");
});

it("multi-series comparisons expose labels, units and exact category values without client measurement", () => {
  const html = renderToStaticMarkup(<SeriesChart rows={[{ label: "Doer", good: 4, late: 2 }]} series={[{ key: "good", label: "On time", color: "var(--chart-good)" }, { key: "late", label: "Delayed", color: "var(--chart-warning)" }]} unit="tasks" emptyMessage="Empty" stacked />);
  expect(html).toContain("On time"); expect(html).toContain("Delayed"); expect(html).toContain("tasks"); expect(html).toContain("<table"); expect(html).toContain("Doer");
});
it("timelines retain their old call shape but can label monetary units and chronological columns", () => {
  const html = renderToStaticMarkup(<TimelineChart points={[{ label: "2026-10", value: 125.5 }]} emptyMessage="Empty" valueSuffix=" INR" kind="column" />);
  expect(html).toContain("125.5 INR"); expect(html).toContain("<ul");
});

it("series charts preserve explicitly missing measures as gaps, not zero or discarded stock", () => {
  const html = renderToStaticMarkup(<SeriesChart rows={[{ label: "FG", stock: 7, reorder: null }]} series={[{ key: "stock", label: "Stock", color: "var(--chart-good)" }, { key: "reorder", label: "ROP", color: "var(--chart-warning)" }]} unit="PCS" emptyMessage="Empty" />);
  expect(html).toContain("FG"); expect(html).toContain("7"); expect(html).toContain("—");
});

it("empty comparisons show the caller's empty state, not an unexplained zero chart", () => {
  const html = renderToStaticMarkup(<BarChart data={[{ label: "Passed", value: 0, color: "var(--chart-good)" }]} emptyMessage="No inspections" emptyWhenZero />);
  expect(html).toContain("No inspections");
});
it.each(["Score", "Stock"])("a legitimate zero %s remains visible when zero-empty behavior is not requested", label => {
  const html = renderToStaticMarkup(<BarChart data={[{ label, value: 0, color: "var(--chart-good)" }]} emptyMessage="Empty" />);
  expect(html).toContain("<ul"); expect(html).toContain(label); expect(html).not.toContain("Empty");
});
