/**
 * India statutory payroll deduction formulas — PF (EPF), ESI, and TDS (income tax
 * withholding). Deliberately simplified, deliberately documented as simplified at every
 * point a real payroll/compliance system would need more nuance — this is calculation
 * logic only, never e-filing/government-API integration (that's GST e-filing's own,
 * separately-scoped item: it needs a real GSP/ASP partner account — ClearTax, Zoho GST,
 * etc. — which is a user-only credentials/billing decision, not something this session
 * can set up. Treat every number here as "what the payslip should show", not as a filed
 * return — an org's actual accountant/CA must still review and file PF/ESI/TDS returns
 * through the government's own portals (EPFO, ESIC, TRACES) using these same figures.
 *
 * Every calculation is OPT-IN per organization via three Settings keys, all unset/false
 * by default — so no existing org's payroll numbers change unless they deliberately turn
 * this on (Admin -> Settings -> Payroll Compliance, once that UI is wired):
 *   PF_ENABLED  = "true" | "false" (default false)
 *   ESI_ENABLED = "true" | "false" (default false)
 *   TDS_ENABLED = "true" | "false" (default false)
 *
 * Rates, slabs, and ceilings below are current as of FY2024-25 (India) at the time this
 * was written — EPFO/ESIC/CBDT revise these periodically (ESI's wage ceiling and PF's
 * statutory wage ceiling have both changed multiple times historically). Re-verify against
 * the current official notification before relying on this in a live payroll run far in
 * the future; this is NOT wired to any live rate-update feed.
 */

// ---------------------------------------------------------------------------------------
// PF (Employees' Provident Fund) — EPFO
// ---------------------------------------------------------------------------------------

/** The statutory PF wage ceiling (Basic + DA) — EPFO contribution is computed on whichever
 * is lower: the employee's actual PF wage, or this ceiling. An employer MAY contribute on
 * the full actual wage voluntarily, but that is a configuration choice this codebase does
 * not expose — ceiling-capped is the safe statutory-minimum default. */
const PF_WAGE_CEILING = 15000;

const PF_EMPLOYEE_RATE = 0.12; // 12% of PF wage, deducted from the employee
// Employer's 12% split: 8.33% to EPS (pension, capped at the wage ceiling regardless of
// actual wage) + 3.67% to EPF proper. Both employer-side; this module computes their sum
// since no feature yet needs them separately reported.
const PF_EMPLOYER_EPS_RATE = 0.0833;
const PF_EMPLOYER_EPF_RATE = 0.0367;

export interface PfResult {
  pfWage: number;
  employeeContribution: number;
  employerContribution: number;
}

/** `monthlySalary` here is treated as the whole PF wage (Basic+DA) — this codebase has no
 * Basic/HRA/DA salary-head breakdown (salaryStructures.monthlySalary is a single number),
 * so the full monthly salary is used as PF wage. A real payroll system with salary heads
 * would compute PF only on Basic+DA, typically 40-50% of gross — treating the whole salary
 * as PF wage is the more statutorily SAFE (if imprecise) direction: it never under-deducts
 * employee PF relative to a heads-based calculation, only ever over-estimates it slightly
 * for an org whose actual Basic is a smaller fraction of gross than assumed here. */
export function computePf(monthlySalary: number): PfResult {
  const pfWage = Math.min(monthlySalary, PF_WAGE_CEILING);
  const employeeContribution = round2(pfWage * PF_EMPLOYEE_RATE);
  const employerContribution = round2(pfWage * (PF_EMPLOYER_EPS_RATE + PF_EMPLOYER_EPF_RATE));
  return { pfWage, employeeContribution, employerContribution };
}

// ---------------------------------------------------------------------------------------
// ESI (Employees' State Insurance) — ESIC
// ---------------------------------------------------------------------------------------

/** ESI applies only when GROSS monthly wage is at or below this ceiling — unlike PF, there
 * is no partial/capped contribution above the ceiling: a worker earning even slightly over
 * it is simply outside the ESI scheme entirely for that month. */
const ESI_WAGE_CEILING = 21000;
const ESI_EMPLOYEE_RATE = 0.0075; // 0.75% of gross wage
const ESI_EMPLOYER_RATE = 0.0325; // 3.25% of gross wage

export interface EsiResult {
  applicable: boolean;
  employeeContribution: number;
  employerContribution: number;
}

export function computeEsi(grossPay: number): EsiResult {
  if (grossPay > ESI_WAGE_CEILING) {
    return { applicable: false, employeeContribution: 0, employerContribution: 0 };
  }
  return {
    applicable: true,
    employeeContribution: round2(grossPay * ESI_EMPLOYEE_RATE),
    employerContribution: round2(grossPay * ESI_EMPLOYER_RATE),
  };
}

// ---------------------------------------------------------------------------------------
// TDS (income tax withholding) — a deliberately simplified estimate, NOT a real Form 16
// ---------------------------------------------------------------------------------------

/**
 * This is an approximation only, clearly short of a real TDS-on-salary calculation, which
 * would additionally need: the employee's declared tax regime choice (old vs new), HRA/80C/
 * other exemptions and declarations, other income declared to the employer, a
 * previous-employer TDS certificate within the same FY, and marginal-relief/surcharge
 * rules above ₹50L. None of those inputs exist anywhere in this codebase's schema today.
 *
 * What this DOES do, honestly: projects the CURRENT monthly salary to an annual figure
 * (monthlySalary * 12 — no mid-year joiner/raise awareness), applies the new tax regime's
 * slabs (the default regime since FY2023-24, and the one requiring the fewest additional
 * inputs to approximate), applies the standard deduction, and divides the resulting annual
 * tax by 12 for a flat monthly TDS estimate. Deliberately not cumulative/reconciling like
 * real monthly TDS computation (which recomputes each month against the full year as
 * salary accrues and adjusts prior months' withholding) — this is a first-pass estimate a
 * payslip can show, explicitly not a substitute for the org's own CA/payroll-compliance
 * review before any real filing.
 */
const NEW_REGIME_STANDARD_DEDUCTION = 75000; // FY2024-25, new regime
// (lower bound inclusive, upper bound exclusive, rate) — FY2024-25 new regime slabs.
const NEW_REGIME_SLABS: { upTo: number; rate: number }[] = [
  { upTo: 300000, rate: 0 },
  { upTo: 700000, rate: 0.05 },
  { upTo: 1000000, rate: 0.1 },
  { upTo: 1200000, rate: 0.15 },
  { upTo: 1500000, rate: 0.2 },
  { upTo: Infinity, rate: 0.3 },
];
// Section 87A rebate under the new regime: tax is fully rebated (to zero) when taxable
// income does not exceed this threshold — applied before cess.
const REBATE_INCOME_LIMIT = 700000;
const CESS_RATE = 0.04; // Health & Education Cess, applied on tax after rebate.

function computeAnnualTaxNewRegime(taxableIncome: number): number {
  if (taxableIncome <= 0) return 0;
  let tax = 0;
  let lowerBound = 0;
  for (const slab of NEW_REGIME_SLABS) {
    if (taxableIncome <= lowerBound) break;
    const taxableInThisSlab = Math.min(taxableIncome, slab.upTo) - lowerBound;
    tax += taxableInThisSlab * slab.rate;
    lowerBound = slab.upTo;
  }
  if (taxableIncome <= REBATE_INCOME_LIMIT) {
    return 0;
  }
  return tax * (1 + CESS_RATE);
}

export interface TdsResult {
  annualTaxableIncomeEstimate: number;
  annualTaxEstimate: number;
  monthlyTds: number;
}

export function computeTds(monthlySalary: number): TdsResult {
  const annualGross = monthlySalary * 12;
  const annualTaxableIncomeEstimate = Math.max(0, annualGross - NEW_REGIME_STANDARD_DEDUCTION);
  const annualTaxEstimate = round2(computeAnnualTaxNewRegime(annualTaxableIncomeEstimate));
  const monthlyTds = round2(annualTaxEstimate / 12);
  return { annualTaxableIncomeEstimate, annualTaxEstimate, monthlyTds };
}

// ---------------------------------------------------------------------------------------

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface StatutoryDeductions {
  pfEmployee: number;
  pfEmployer: number;
  esiEmployee: number;
  esiEmployer: number;
  tds: number;
}

export interface StatutoryFlags {
  pfEnabled: boolean;
  esiEnabled: boolean;
  tdsEnabled: boolean;
}

/** Applies only the deductions this org has opted into (all default false, see this
 * file's header) — an org that enables none of the three gets back all zeros, identical
 * to v1's behavior before these existed. */
export function computeStatutoryDeductions(
  monthlySalary: number,
  grossPay: number,
  flags: StatutoryFlags
): StatutoryDeductions {
  const pf = flags.pfEnabled ? computePf(monthlySalary) : null;
  const esi = flags.esiEnabled ? computeEsi(grossPay) : null;
  const tds = flags.tdsEnabled ? computeTds(monthlySalary) : null;

  return {
    pfEmployee: pf?.employeeContribution ?? 0,
    pfEmployer: pf?.employerContribution ?? 0,
    esiEmployee: esi?.employeeContribution ?? 0,
    esiEmployer: esi?.employerContribution ?? 0,
    tds: tds?.monthlyTds ?? 0,
  };
}

export interface CappedStatutoryDeductions extends StatutoryDeductions {
  /** Total employee-side deduction amount (PF+ESI+TDS) that could not actually be
   * withheld this period because doing so would have exceeded the employee's actual
   * grossPay — see capDeductionsToGrossPay's own doc comment for the full policy. Zero
   * in the normal case (grossPay comfortably covers whatever was computed). */
  deductionShortfall: number;
}

/**
 * OPS-02 POLICY DECISION — explicit, documented, and deliberately overridable; this is an
 * arithmetic/policy-safety fix, NOT a statutory ruling (see this file's header: nothing
 * here is legally authoritative). computeStatutoryDeductions() above computes PF/ESI/TDS
 * off `monthlySalary`/the period's `grossPay` as if a full/normal amount was actually
 * earned. For a zero or partial-pay period (no attendance yet this month, a same-month
 * join+exit, unpaid leave once that exists) that can produce deductions bigger than what
 * was actually earned — e.g. monthlySalary=20000, grossPay=0, PF enabled still computes a
 * flat ₹1800 employee PF contribution, which would make netPay = 0 - 1800 = -1800 if
 * applied without this cap.
 *
 * Chosen default: scale every employee-side deduction by the SAME proportion
 * (`grossPay / totalRequestedDeductions`) rather than paying one deduction in full at
 * another's expense or zeroing everything out — no single deduction (say PF) is singled
 * out to absorb the whole shortfall while another (say TDS) is paid in full from a
 * partial paycheck. Each deduction is additionally hard-capped by whatever of grossPay the
 * previous ones in a fixed PF -> ESI -> TDS order left unclaimed, purely as a
 * rounding-safety valve, so the sum withheld can never exceed grossPay by even a cent.
 * Employer-side contributions (pfEmployer/esiEmployer) are left untouched: they're the
 * organization's own cost, not money withheld from the employee, so there is nothing to
 * cap there.
 *
 * Whatever could NOT be withheld is reported back as `deductionShortfall` rather than
 * vanishing into a negative netPay or a silent full write-off — a payslip must show what
 * was ACTUALLY withheld this period, and the org must be able to see (and separately
 * decide how to handle — carry forward, write off, recover another way) whatever PF/ESI/
 * TDS liability this period fell short of. This module deliberately does NOT carry the
 * shortfall forward to a future period's deduction automatically — that is a genuine
 * payroll/compliance policy choice for a human to make, not one this calculation layer
 * should assume silently.
 */
export function capDeductionsToGrossPay(
  deductions: StatutoryDeductions,
  grossPay: number
): CappedStatutoryDeductions {
  const safeGrossPay = Math.max(0, grossPay);
  const totalRequested = round2(deductions.pfEmployee + deductions.esiEmployee + deductions.tds);

  if (totalRequested <= 0 || totalRequested <= safeGrossPay) {
    return { ...deductions, deductionShortfall: 0 };
  }

  const scale = safeGrossPay / totalRequested;
  let remaining = safeGrossPay;
  const takeProportional = (requested: number): number => {
    const taken = Math.min(round2(requested * scale), remaining);
    remaining = round2(remaining - taken);
    return taken;
  };
  const pfEmployee = takeProportional(deductions.pfEmployee);
  const esiEmployee = takeProportional(deductions.esiEmployee);
  const tds = takeProportional(deductions.tds);
  const cappedTotal = round2(pfEmployee + esiEmployee + tds);

  return {
    ...deductions,
    pfEmployee,
    esiEmployee,
    tds,
    deductionShortfall: round2(totalRequested - cappedTotal),
  };
}
