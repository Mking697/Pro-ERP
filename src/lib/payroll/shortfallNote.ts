/**
 * OPS-02 — shared, pure "deduction shortfall" display text, used by both the payroll
 * generation UI (src/app/payroll/payroll-admin-console.tsx) and the payslip PDF
 * (src/lib/payroll/payslipPdf.tsx), so the two surfaces never drift on wording.
 *
 * `deductionShortfall` (see statutory.ts's capDeductionsToGrossPay doc comment for the
 * full policy) is how much of the computed employee-side PF/ESI/TDS could NOT actually be
 * withheld this period because doing so would have exceeded the employee's actual
 * grossPay. It is currently only available on `generatePayrollRun()`'s in-memory response
 * (GeneratedPayslip) — it is NOT a persisted `payslips` column yet (see this module's own
 * header note in payroll.ts / the OPS-02 handoff for the proposed schema addition), so a
 * Draft/Finalized run reopened later (getPayrollRun()) cannot show it again. This function
 * is deliberately forward-compatible: once a `payslips.deduction_shortfall` column exists,
 * the same callers can pass that persisted value through unchanged.
 *
 * NO STATUTORY-COMPLIANCE CLAIM: this note describes an arithmetic/policy-safety outcome
 * of this codebase's own simplified calculation (see statutory.ts's header) — it is not a
 * legal/compliance determination of what is actually owed to PF/ESI/TDS authorities. An
 * org's own accountant/CA must review before relying on it for filing.
 */
export function buildDeductionShortfallNote(deductionShortfall: number): string | null {
  if (!Number.isFinite(deductionShortfall) || deductionShortfall <= 0) return null;
  return (
    `Deduction shortfall: Rs. ${deductionShortfall.toFixed(2)} of computed PF/ESI/TDS could not ` +
    "be withheld this period (grossPay was insufficient) — not a statutory filing, see your " +
    "organization's own payroll policy for how this should be recovered or written off."
  );
}
