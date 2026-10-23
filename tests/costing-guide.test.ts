import { expect, it } from "vitest";
import { GUIDE } from "@/lib/guide";
import { GUIDE_EN } from "@/lib/guide.en";
it("both guide languages include grant-specific costing steps, snapshot rules and a worked example", () => {
 for(const guide of [GUIDE,GUIDE_EN]) {
  const section=guide.flatMap(c=>c.sections).find(s=>s.id==="product-cost-sheets");
  expect(section?.audience).toBe("COST_SHEETS");
  expect(section?.steps?.length).toBeGreaterThanOrEqual(6);
  expect(section?.example?.lines.join(" ")).toContain("120");
  expect(section?.notes?.join(" ")).toMatch(/actual|Actual/);
 }
});
