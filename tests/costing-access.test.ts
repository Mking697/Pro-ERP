import { expect, it } from "vitest";
import { MODULE_ACCESS, effectiveModuleAccess, parseModuleAccess } from "@/lib/moduleAccess";

it("cost sheets has its own grant and destination rather than inheriting inventory/purchase access", () => {
  expect(MODULE_ACCESS.find(module => String(module.key) === "COST_SHEETS")).toMatchObject({ href: "/cost-sheets" });
  expect(effectiveModuleAccess("Doer", "INVENTORY_VIEW,PURCHASE_FMS")).not.toContain("COST_SHEETS");
});
it("existing Admin accounts implicitly obtain the costing grant without mutating user data", () => {
  expect(effectiveModuleAccess("Admin", "")).toContain("COST_SHEETS");
});
it("an ordinary user's costing access requires the explicit recognized grant", () => {
  expect(parseModuleAccess("COST_SHEETS")).toEqual(["COST_SHEETS"]);
  expect(parseModuleAccess("COST_SHEET")).toEqual([]);
});
