import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { CostCalculation, CostSheet } from "@/lib/costing/types";
vi.mock("@/components/preferences-provider", () => ({ useT: () => (s: string) => s }));
import Snapshot from "@/app/cost-sheets/snapshot";

export const calculation: CostCalculation = {
  productSku: "FG", productName: "Product", productUom: "PCS", bomId: "bom1", bomVersion: "3",
  input: { productSku: "FG", batchQty: "2.000", asOfDate: "2026-10-23", charges: [] },
  materials: [{ sku: "RM", name: "Material", uom: "KG", qtyPerUnit: "1.250", requiredQty: "2.500", rate: null, amount: null, source: { kind: "Missing", id: "", date: "", description: "No eligible rate" } }],
  charges: [], complete: false, warnings: ["Missing rate: RM"],
  totals: { knownMaterialSubtotal: "0.00", material: null, labour: "0.00", directExpenses: "0.00", factoryOverhead: "0.00", manufacturing: null, commercial: "0.00", fullCost: null, perUnit: null },
};
export const saved: CostSheet = { id: "saved / 1", productSku: "FG", productName: "Product", revision: 2, status: "Draft", version: 4, calculation, supersedesId: null, createdAt: "2026-10-23T09:00:00Z", createdBy: "user1", updatedAt: "2026-10-23T09:00:00Z", finalizedAt: null, finalizedBy: null };
it("snapshot preserves decimal strings, missing valuation and saved provenance without inventing totals", () => {
  const markup = renderToStaticMarkup(<Snapshot calculation={calculation} sheet={saved} />);
  expect(markup).toContain("2.500");
  expect(markup).toContain("1.250");
  expect(markup).toContain("Unavailable");
  expect(markup).toContain("INR");
  expect(markup).toContain("No eligible rate");
  expect(markup).toContain("Missing rate: RM");
  expect(markup).toContain("saved / 1");
  expect(markup).toContain("bom1");
  expect(markup).toContain("user1");
});
it("snapshot distinguishes explicit zero from missing and shows source dates and charge bases", () => {
  const c: CostCalculation = { ...calculation, materials: [{ ...calculation.materials[0], rate: "0.00", amount: "0.00", source: { kind: "Standard", id: "rate1", date: "2026-10-01", description: "Approved free issue" } }], charges: [{ head: "Labour", description: "Assembly", basis: "LabourHours", quantity: "3", rate: "12.50", appliedQuantity: "3", amount: "37.50" }] };
  const markup = renderToStaticMarkup(<Snapshot calculation={c} />);
  expect(markup).toContain("0.00");
  expect(markup).toContain("2026-10-01");
  expect(markup).toContain("Source age (days at sheet date)");
  expect(markup).toContain("<td>22</td>");
  expect(markup).toContain("rate1");
  expect(markup).toContain("37.50");
  expect(markup).toContain("LabourHours");
});
