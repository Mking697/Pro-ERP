import { describe, expect, it } from "vitest";
import {
  capDeductionsToGrossPay,
  computeEsi,
  computePf,
  computeStatutoryDeductions,
  computeTds,
} from "@/lib/payroll/statutory";

describe("PF (Provident Fund)", () => {
  it("caps PF wage at the statutory ceiling for a salary above it", () => {
    const result = computePf(50000);
    expect(result.pfWage).toBe(15000);
    expect(result.employeeContribution).toBe(1800); // 12% of 15000
    expect(result.employerContribution).toBe(1800); // (8.33% + 3.67%) of 15000
  });

  it("uses the actual salary as PF wage when below the ceiling", () => {
    const result = computePf(10000);
    expect(result.pfWage).toBe(10000);
    expect(result.employeeContribution).toBe(1200); // 12% of 10000
  });

  it("computes zero for zero salary", () => {
    const result = computePf(0);
    expect(result.employeeContribution).toBe(0);
    expect(result.employerContribution).toBe(0);
  });
});

describe("ESI (Employees' State Insurance)", () => {
  it("applies below the wage ceiling", () => {
    const result = computeEsi(20000);
    expect(result.applicable).toBe(true);
    expect(result.employeeContribution).toBe(150); // 0.75% of 20000
    expect(result.employerContribution).toBe(650); // 3.25% of 20000
  });

  it("applies exactly at the wage ceiling", () => {
    const result = computeEsi(21000);
    expect(result.applicable).toBe(true);
  });

  it("does NOT apply above the wage ceiling", () => {
    const result = computeEsi(21001);
    expect(result.applicable).toBe(false);
    expect(result.employeeContribution).toBe(0);
    expect(result.employerContribution).toBe(0);
  });
});

describe("TDS (estimated, new regime)", () => {
  it("is zero for income within the Section 87A rebate threshold", () => {
    // 50000/month = 600000/year, well under the 700000 rebate limit even before the
    // standard deduction further reduces taxable income.
    const result = computeTds(50000);
    expect(result.monthlyTds).toBe(0);
  });

  it("is zero for annual income right at the rebate boundary after standard deduction", () => {
    // (700000 + 75000)/12 ≈ 64583.33/month -> annual 775000 - 75000 = 700000 taxable,
    // exactly at the rebate threshold -> rebate still applies, zero tax.
    const result = computeTds(64583.33);
    expect(result.annualTaxableIncomeEstimate).toBeLessThanOrEqual(700000);
    expect(result.monthlyTds).toBe(0);
  });

  it("computes real tax above the rebate threshold", () => {
    // 150000/month = 1800000/year - 75000 standard deduction = 1725000 taxable.
    // Slabs: 0-300000@0 + 300000-700000@5% + 700000-1000000@10% + 1000000-1200000@15%
    // + 1200000-1500000@20% + 1500000-1725000@30%
    // = 0 + 20000 + 30000 + 30000 + 60000 + 67500 = 207500, * 1.04 cess = 215800
    const result = computeTds(150000);
    expect(result.annualTaxableIncomeEstimate).toBe(1725000);
    expect(result.annualTaxEstimate).toBe(215800);
    expect(result.monthlyTds).toBe(round2(215800 / 12));
  });

  it("scales up for a very high income (confirms top slab applies)", () => {
    const low = computeTds(150000);
    const high = computeTds(300000);
    expect(high.monthlyTds).toBeGreaterThan(low.monthlyTds);
  });
});

describe("computeStatutoryDeductions — opt-in flags", () => {
  it("returns all zeros when every flag is off (v1 behavior, unchanged)", () => {
    const result = computeStatutoryDeductions(50000, 50000, {
      pfEnabled: false,
      esiEnabled: false,
      tdsEnabled: false,
    });
    expect(result).toEqual({ pfEmployee: 0, pfEmployer: 0, esiEmployee: 0, esiEmployer: 0, tds: 0 });
  });

  it("applies only the flags that are on", () => {
    const result = computeStatutoryDeductions(20000, 20000, {
      pfEnabled: true,
      esiEnabled: false,
      tdsEnabled: false,
    });
    expect(result.pfEmployee).toBeGreaterThan(0);
    expect(result.esiEmployee).toBe(0);
    expect(result.tds).toBe(0);
  });

  it("applies all three together when all are on", () => {
    const result = computeStatutoryDeductions(20000, 20000, {
      pfEnabled: true,
      esiEnabled: true,
      tdsEnabled: true,
    });
    expect(result.pfEmployee).toBeGreaterThan(0);
    expect(result.esiEmployee).toBeGreaterThan(0);
    // TDS at this income is well under the rebate threshold, so 0 is still correct here.
    expect(result.tds).toBe(0);
  });
});

describe("capDeductionsToGrossPay — OPS-02 zero/partial-pay safety", () => {
  it("does not touch deductions when grossPay comfortably covers them", () => {
    const deductions = { pfEmployee: 1800, pfEmployer: 1800, esiEmployee: 0, esiEmployer: 0, tds: 0 };
    const result = capDeductionsToGrossPay(deductions, 20000);
    expect(result).toEqual({ ...deductions, deductionShortfall: 0 });
  });

  it("reproduces the finding: monthlySalary=20000, grossPay=0, PF enabled -> zero deduction, full shortfall reported", () => {
    const pf = computePf(20000); // 1800 flat (ceiling-capped PF wage)
    const deductions = { pfEmployee: pf.employeeContribution, pfEmployer: pf.employerContribution, esiEmployee: 0, esiEmployer: 0, tds: 0 };
    const result = capDeductionsToGrossPay(deductions, 0);
    expect(result.pfEmployee).toBe(0);
    expect(result.deductionShortfall).toBe(1800);
    // Employer-side contribution is untouched — it's the org's own cost, not withheld pay.
    expect(result.pfEmployer).toBe(1800);
  });

  it("caps deductions PROPORTIONALLY, not by priority order, when grossPay partially covers them", () => {
    // PF=1800, ESI=10 requested, grossPay only 905 (half of the 1810 requested total).
    const deductions = { pfEmployee: 1800, pfEmployer: 1800, esiEmployee: 10, esiEmployer: 43.33, tds: 0 };
    const result = capDeductionsToGrossPay(deductions, 905);
    expect(result.pfEmployee + result.esiEmployee + result.tds).toBeLessThanOrEqual(905);
    // Each deduction shrinks by roughly the same ~50% factor — neither is zeroed to let the
    // other through in full.
    expect(result.pfEmployee).toBeGreaterThan(0);
    expect(result.pfEmployee).toBeLessThan(1800);
    expect(result.esiEmployee).toBeGreaterThan(0);
    expect(result.esiEmployee).toBeLessThan(10);
    expect(result.pfEmployee / 1800).toBeCloseTo(result.esiEmployee / 10, 1);
    expect(result.deductionShortfall).toBeCloseTo(1810 - 905, 1);
  });

  it("never lets net pay go negative: grossPay minus capped deductions is always >= 0", () => {
    for (const grossPay of [0, 1, 500, 1799.99, 1800, 1800.01, 5000]) {
      const deductions = { pfEmployee: 1800, pfEmployer: 1800, esiEmployee: 0, esiEmployer: 0, tds: 0 };
      const result = capDeductionsToGrossPay(deductions, grossPay);
      const netPay = round2(grossPay - result.pfEmployee - result.esiEmployee - result.tds);
      expect(netPay).toBeGreaterThanOrEqual(0);
    }
  });
});

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
