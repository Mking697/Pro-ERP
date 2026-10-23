import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import CostSheetLink from "@/components/cost-sheet-link";
it("product cost links preserve SKU identity including reserved URL characters", () => {
  const html = renderToStaticMarkup(<CostSheetLink sku="FG/A & B" canView label="Cost Sheets" />);
  expect(html).toContain("/cost-sheets?productSku=FG%2FA%20%26%20B");
  expect(html).toContain("Cost Sheets");
});
it("product costing entry points stay hidden without the sensitive costing grant", () => {
  expect(renderToStaticMarkup(<CostSheetLink sku="FG" canView={false} label="Cost Sheets" />)).toBe("");
});
