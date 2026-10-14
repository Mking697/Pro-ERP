import { describe, expect, it } from "vitest";
import { validateCreate, validateAssignment, validateStep, parseCycle, assertStepTransition, validateUpload } from "@/lib/fieldService/validation";

describe("field service validation", () => {
  it("rejects non-object JSON", () => { for (const v of [null, [], "x", 1]) expect(() => validateCreate("SERVICE", v, "org-a")).toThrow(); });
  it("rejects malformed optional text", () => { expect(() => validateCreate("SERVICE", {customerId:"c", brand:42}, "org-a")).toThrow(); });
  it("rejects invalid enums instead of silently defaulting", () => { expect(() => validateCreate("COMPLAINT", {customerId:"c", issueDescription:"broken", warrantyStatus:"wrong"}, "org-a")).toThrow(); });
  it("accepts a tenant upload", () => { expect(validateUpload("/uploads/orgs/org-a/ATT-123-photo.jpg", "org-a")).toBe("/uploads/orgs/org-a/ATT-123-photo.jpg"); });
  it("accepts configured absolute upload base only", () => { expect(validateUpload("https://cdn.example/assets/orgs/org-a/ATT-123-photo.jpg", "org-a", false, "https://cdn.example/assets")).toBeTruthy(); expect(() => validateUpload("https://evil.example/assets/orgs/org-a/ATT-123-photo.jpg", "org-a", false, "https://cdn.example/assets")).toThrow(); });
  it("rejects foreign, encoded, traversal, query and executable URLs", () => { for (const url of ["/uploads/orgs/org-b/ATT-x.jpg", "https://evil.example/uploads/orgs/org-a/ATT-x.jpg", "/uploads/orgs/org-a/../org-b/x", "/uploads/orgs/org-a/%2e%2e/x", "/uploads/orgs/org-a/ATT-x.jpg?x=1", "javascript:alert(1)"]) expect(() => validateUpload(url,"org-a")).toThrow(); });
  it("rejects non-finite negative and coercible amounts", () => { for (const amount of [NaN, Infinity, -1, null, "0"]) expect(() => validateStep("SERVICE",3,{expenseAmount:amount},"org-a")).toThrow(); });
  it("rejects invalid coordinate ranges and null coordinates", () => { for (const latitude of [null, 91, Infinity,"0"]) expect(() => validateStep("SERVICE",1,{sitePhotoUrl:"/uploads/orgs/org-a/ATT-x.jpg",latitude,longitude:0},"org-a")).toThrow(); });
  it("allows zero expense and optional site chart", () => { expect(validateStep("SERVICE",3,{expenseAmount:0},"org-a")).toMatchObject({expenseAmount:0}); expect(validateStep("SITE_VISIT",2,{notes:"survey"},"org-a")).toMatchObject({notes:"survey"}); });
  it("rejects mixed invalid assignee arrays and duplicate ids", () => { for (const doerIds of [["a",3],["a","a"],[],[" "]]) expect(() => validateAssignment({doerIds},"org-a")).toThrow(); });
  it("parses only exact positive cycles", () => { for (const cycle of ["1x","1.1","0","-1","Infinity","01"]) expect(() => parseCycle(cycle)).toThrow(); expect(parseCycle("2")).toBe(2); });
  it("rejects completed or stale-cycle changes", () => { expect(() => assertStepTransition({status:"Completed",currentCycle:1},null,1,1)).toThrow(); expect(() => assertStepTransition({status:"Assigned",currentCycle:2},null,1,1)).toThrow(); });
  it("rejects repeated and out-of-order steps", () => { expect(() => assertStepTransition({status:"In_Progress",currentCycle:1},{step1At:new Date()},1,1)).toThrow(); expect(() => assertStepTransition({status:"Assigned",currentCycle:1},null,2,1)).toThrow(); });
  it("accepts exactly the next step", () => { expect(() => assertStepTransition({status:"Assigned",currentCycle:1},null,1,1)).not.toThrow(); expect(() => assertStepTransition({status:"In_Progress",currentCycle:1},{step1At:new Date(),step2At:new Date()},3,1)).not.toThrow(); });
});
