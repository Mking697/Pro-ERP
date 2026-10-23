import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import type { CostSheet, CostSheetInput } from "@/lib/costing/types";
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as (() => void | (() => void))[], deps: [] as (unknown[] | undefined)[] }));
vi.mock("react", async original => {
  const actual = await original<typeof React>();
  return { ...actual,
    useState: (initial: unknown) => {
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = typeof initial === "function" ? initial() : initial;
      return [hooks.values[index], (next: unknown) => { hooks.values[index] = typeof next === "function" ? next(hooks.values[index]) : next; }];
    },
    useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
    useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
      const index = hooks.cursor++;
      const prior = hooks.deps[index];
      if (!prior || deps.some((value, i) => value !== prior[i])) hooks.effects.push(effect);
      hooks.deps[index] = deps;
    },
  };
});
vi.mock("@/components/preferences-provider", () => ({ useT: () => (s: string) => s }));
import Board from "@/app/cost-sheets/cost-sheets-board";
import PrintActions from "@/app/cost-sheets/[id]/print/print-actions";

type Props = { children?: React.ReactNode; onClick?: () => unknown; onChange?: (event: { target: { value: string } }) => unknown; onSubmit?: (event: { preventDefault: () => void }) => unknown; disabled?: boolean; href?: string; id?: string };
function nodes(node: React.ReactNode): React.ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!React.isValidElement<Props>(node)) return [];
  return [node, ...nodes(node.props.children)];
}
const text = (node: React.ReactNode): string => Array.isArray(node) ? node.map(text).join("") : React.isValidElement<Props>(node) ? text(node.props.children) : typeof node === "string" || typeof node === "number" ? String(node) : "";
function render() { hooks.cursor = 0; return Board({ initialProductSku: "FG", initialDate: "2026-10-23" }); }
function button(tree: React.ReactNode, label: string) { const found = nodes(tree).find(n => n.type === "button" && text(n) === label); expect(found, label).toBeDefined(); return found!; }
function field(tree: React.ReactNode, id: string) { const found = nodes(tree).find(n => n.props.id === id); expect(found, id).toBeDefined(); return found!; }
const input: CostSheetInput = { productSku: "FG", batchQty: "1", asOfDate: "2026-10-23", charges: [] };
const calculation = { productSku: "FG", productName: "Product", productUom: "PCS", bomId: "b1", bomVersion: "1", input, materials: [], charges: [], totals: { knownMaterialSubtotal: "5.00", material: "5.00", labour: "0.00", directExpenses: "0.00", factoryOverhead: "0.00", manufacturing: "5.00", commercial: "0.00", fullCost: "5.00", perUnit: "5.00" }, complete: true, warnings: [] };
const sheet: CostSheet = { id: "saved / exact", productSku: "FG", productName: "Product", revision: 1, version: 1, status: "Draft", calculation, supersedesId: null, createdAt: "2026-10-23T00:00:00Z", createdBy: "U", updatedAt: "2026-10-23T00:00:00Z", finalizedAt: null, finalizedBy: null };
beforeEach(() => { hooks.values = []; hooks.deps = []; hooks.effects = []; hooks.cursor = 0; vi.unstubAllGlobals(); });
it("wires decimal inputs, server preview and draft save then exposes only saved snapshot URLs", async () => {
  const requests: { url: string; options?: RequestInit }[] = [];
  let current = sheet;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("preview")) return new Response(JSON.stringify({ calculation: { ...calculation, input: JSON.parse(String(options?.body)) } }));
    if (options?.method === "POST") current = { ...sheet, calculation: { ...calculation, input: JSON.parse(String(options.body)).input } };
    return new Response(JSON.stringify({ sheet: current }));
  }));
  let tree = render();
  expect(nodes(tree).some(n => n.props.href?.endsWith("/export"))).toBe(false);
  field(tree, "cost-batch").props.onChange!({ target: { value: "2.500" } });
  tree = render();
  await button(tree, "Preview / recalculate").props.onClick!();
  expect(JSON.parse(String(requests[0].options?.body)).batchQty).toBe("2.500");
  tree = render();
  await button(tree, "Save draft").props.onClick!();
  tree = render();
  expect(nodes(tree).map(n => n.props.href)).toContain("/api/cost-sheets/saved%20%2F%20exact/export");
  expect(nodes(tree).map(n => n.props.href)).toContain("/cost-sheets/saved%20%2F%20exact/print");
  expect(button(tree, "Finalize saved snapshot").props.disabled).toBe(false);
});
it("charge controls keep enum values stable and strings uncalculated", () => {
  let tree = render();
  button(tree, "Add charge").props.onClick!();
  tree = render();
  field(tree, "charge-rate-0").props.onChange!({ target: { value: "12.50" } });
  tree = render();
  field(tree, "charge-basis-0").props.onChange!({ target: { value: "MachineHours" } });
  tree = render();
  expect(nodes(tree).find(n => n.type === "input" && n.props.id === "charge-rate-0")?.props).toMatchObject({ value: "12.50" });
  expect(nodes(tree).find(n => n.type === "select" && n.props.id === "charge-basis-0")?.props).toMatchObject({ value: "MachineHours" });
});
it("unknown writes expose exact-intent retry and disable edits", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => { throw new Error("Lost response"); }));
  let tree = render();
  await button(tree, "Save draft").props.onClick!();
  tree = render();
  expect(button(tree, "Retry same request").props.disabled).toBe(false);
  expect(button(tree, "Save draft").props.disabled).toBe(true);
  expect(nodes(tree).some(n => n.type === "fieldset" && n.props.disabled)).toBe(true);
});
it("accepted-but-advanced recovery explicitly loads current inputs without another mutation", async () => {
  const writes: RequestInit[] = [];
  const current = { ...sheet, version: 2, calculation: { ...calculation, input: { ...input, batchQty: "9" } } };
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (_url, options) => {
    if (options?.method === "POST") { writes.push(options); if (writes.length === 1) throw new Error("Lost response"); return new Response(JSON.stringify({ sheet })); }
    return new Response(JSON.stringify({ sheet: current }));
  }));
  let tree = render();
  await button(tree, "Save draft").props.onClick!();
  tree = render();
  await button(tree, "Retry same request").props.onClick!();
  tree = render();
  expect(text(tree)).toContain("Request accepted");
  expect(text(tree)).not.toContain("outcome unresolved");
  expect(nodes(tree).some(n => n.type === "button" && text(n) === "Retry same request")).toBe(false);
  expect(field(tree, "cost-batch").props).toMatchObject({ value: "1" });
  expect(button(tree, "Save draft").props.disabled).toBe(true);
  await button(tree, "Load current snapshot / replace inputs").props.onClick!();
  tree = render();
  expect(field(tree, "cost-batch").props).toMatchObject({ value: "9" });
  expect(button(tree, "Update draft / recalculate").props.disabled).toBe(false);
  expect(writes).toHaveLength(2);
  expect(writes[1].body).toBe(writes[0].body);
  expect(writes[1].headers).toEqual(writes[0].headers);
});
it("loads history, finalizes the saved version and creates a revision of that snapshot", async () => {
  const requests: { url: string; options?: RequestInit }[] = [];
  let current = sheet;
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, options) => {
    const path = String(url);
    requests.push({ url: path, options });
    if (path.endsWith("catalog")) return new Response(JSON.stringify({ products: [{ sku: "FG", name: "Product", uom: "PCS", bomId: "b1", bomVersion: "1" }] }));
    if (path.includes("?productSku=")) return new Response(JSON.stringify({ sheets: [{ ...sheet, asOfDate: input.asOfDate, batchQty: "1", totalCost: "5.00" }] }));
    if (path.endsWith("/finalize")) current = { ...sheet, status: "Finalized", version: 2, finalizedAt: "2026-10-23T01:00:00Z", finalizedBy: "U" };
    if (path === "/api/cost-sheets" && options?.method === "POST") current = { ...sheet, id: "revision2", supersedesId: sheet.id, revision: 2 };
    return new Response(JSON.stringify({ sheet: current }));
  }));
  render();
  hooks.effects.splice(0).forEach(effect => effect());
  await vi.waitFor(() => expect(text(render())).toContain("Open saved snapshot"));
  let tree = render();
  await button(tree, "Open saved snapshot").props.onClick!();
  tree = render();
  await button(tree, "Finalize saved snapshot").props.onClick!();
  expect(JSON.parse(String(requests.find(r => r.url.endsWith("/finalize"))?.options?.body))).toEqual({ expectedVersion: 1 });
  tree = render();
  await button(tree, "Create new revision").props.onClick!();
  expect(JSON.parse(String(requests.find(r => r.url === "/api/cost-sheets" && r.options?.method === "POST")?.options?.body))).toEqual({ input, supersedesId: "saved / exact" });
});
it("approval submits selected preview material UOM and explicit zero, then requires another preview", async () => {
  const requests: { url: string; options?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (url, options) => {
    requests.push({ url: String(url), options });
    return new Response(JSON.stringify(String(url).endsWith("preview") ? { calculation: { ...calculation, materials: [{ sku: "RM", name: "Material", uom: "KG" }] } } : { rate: { id: "r1" } }));
  }));
  let tree = render();
  await button(tree, "Preview / recalculate").props.onClick!();
  tree = render();
  field(tree, "standard-material").props.onChange!({ target: { value: "RM" } });
  tree = render();
  field(tree, "standard-rate").props.onChange!({ target: { value: "0.000" } });
  tree = render();
  field(tree, "standard-reason").props.onChange!({ target: { value: "Approved free issue" } });
  tree = render();
  expect(button(tree, "Approve rate").props.disabled).toBe(false);
  nodes(tree).find(n => n.type === "form")!.props.onSubmit!({ preventDefault: vi.fn() });
  await vi.waitFor(() => expect(text(render())).toContain("Rate approved."));
  expect(JSON.parse(String(requests[1].options?.body))).toEqual({ sku: "RM", uom: "KG", rate: "0.000", effectiveDate: "2026-10-23", reason: "Approved free issue" });
  expect(button(render(), "Approve rate").props.disabled).toBe(true);
});
it("catalog products without active BOM cannot preview or save", async () => {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async url => new Response(JSON.stringify(String(url).endsWith("catalog") ? { products: [{ sku: "FG", name: "Product", uom: "PCS", bomId: null, bomVersion: null }] } : { sheets: [] }))));
  render();
  hooks.effects.splice(0).forEach(effect => effect());
  await vi.waitFor(() => expect(text(render())).toContain("Is product ka active BOM nahi hai."));
  expect(button(render(), "Preview / recalculate").props.disabled).toBe(true);
  expect(button(render(), "Save draft").props.disabled).toBe(true);
});
it("print control invokes browser print rather than recalculation", () => {
  const print = vi.fn();
  vi.stubGlobal("window", { print });
  const tree = PrintActions();
  button(tree, "Print saved snapshot").props.onClick!();
  expect(print).toHaveBeenCalledTimes(1);
});
