import { describe, expect, it } from "vitest";
import { buildDeductionShortfallNote } from "@/lib/payroll/shortfallNote";

describe("buildDeductionShortfallNote (OPS-02 — shared UI/PDF shortfall text)", () => {
  it("returns null when there is no shortfall", () => {
    expect(buildDeductionShortfallNote(0)).toBeNull();
  });

  it("returns null for a negative or non-finite value (defensive, never shown as a false shortfall)", () => {
    expect(buildDeductionShortfallNote(-5)).toBeNull();
    expect(buildDeductionShortfallNote(NaN)).toBeNull();
    expect(buildDeductionShortfallNote(Infinity)).toBeNull();
  });

  it("includes the exact shortfall amount, formatted to 2 decimals", () => {
    const note = buildDeductionShortfallNote(1800);
    expect(note).toContain("1800.00");
  });

  it("never claims statutory/filing authority — must not contain compliance-guarantee language", () => {
    const note = buildDeductionShortfallNote(519.36)!;
    expect(note.toLowerCase()).not.toMatch(/guarantee|compliant|statutory filing is/);
    expect(note).toContain("not a statutory filing");
  });
});
