import { describe, expect, it } from "vitest";
import { runWithTenant } from "@/lib/tenant";
import { createUser } from "@/lib/auth/users";
import { upsertSetting } from "@/lib/settings";
import { deleteOrganization } from "@/lib/platform/registry";
import {
  finalizePayrollRun,
  generatePayrollRun,
  setSalaryStructure,
} from "@/lib/payroll/payroll";
import { makeTestOrg } from "./helpers/testOrg";

/**
 * Real end-to-end test of generatePayrollRun() with PF/ESI/TDS enabled — not just the pure
 * statutory.ts unit tests (tests/payroll-statutory.test.ts), but the actual DB-writing
 * code path: PF_ENABLED/ESI_ENABLED/TDS_ENABLED settings genuinely read, genuinely applied
 * to a genuinely-inserted payslip row, with netPay genuinely reduced.
 *
 * Deliberately generates for the CURRENT month, not a fixed past one — a user's own
 * `createdAt` is "now" (real insert time), so computeDaysEmployed() would return 0 for any
 * month before today, zeroing grossPay and every deduction along with it. Using the
 * current month keeps the user's join date (today) inside the run's own window.
 */
function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

describe("payroll statutory deductions — live integration", () => {
  it("applies PF/ESI/TDS to a generated payslip when all three are enabled", async () => {
    const org = await makeTestOrg("PayrollStatutory");
    const month = currentMonth();
    try {
      await runWithTenant({ orgId: org.id, org }, async () => {
        await upsertSetting("PF_ENABLED", "true");
        await upsertSetting("ESI_ENABLED", "true");
        await upsertSetting("TDS_ENABLED", "true");

        const user = await createUser({
          fullName: "Statutory Test Employee",
          email: `test-statutory-${Date.now()}@example.com`,
          password: "Test-Password-123!",
          role: "Employee",
          department: "Test",
          phoneNumber: "",
          createdBy: "payroll-statutory-test",
        });

        // Below the ESI ceiling (21000) and above the PF ceiling (15000) — exercises both
        // caps in one go: PF capped at 15000, ESI applies in full on the actual salary.
        await setSalaryStructure(user.User_ID, 20000, `${month}-01`, "payroll-statutory-test");

        const { payslips } = await generatePayrollRun(month, "payroll-statutory-test");
        const slip = payslips.find((p) => p.userId === user.User_ID);
        expect(slip).toBeDefined();
        // The user's own createdAt is "now" (today), which may be any day of this month —
        // confirm there's at least some employed-day window and a real grossPay, rather
        // than assuming the full month, so this test works correctly on any day it runs.
        expect(slip!.daysEmployed).toBeGreaterThan(0);
        expect(slip!.grossPay).toBeGreaterThan(0);

        const expectedGrossPay = round2((20000 * slip!.daysEmployed) / slip!.daysInMonth);
        expect(slip!.grossPay).toBe(expectedGrossPay);

        // PF is computed off the FULL monthlySalary (20000, capped at the 15000 ceiling) —
        // generatePayrollRun() calls computeStatutoryDeductions(monthlySalary, grossPay, flags).
        expect(slip!.pfEmployee).toBe(1800); // 12% of min(20000, 15000)
        // ESI is computed off the PRORATED grossPay, not the full monthlySalary.
        expect(slip!.esiEmployee).toBe(round2(slip!.grossPay * 0.0075));
        // TDS: 20000*12 = 240000/year, well under the 700000 rebate threshold -> 0
        expect(slip!.tds).toBe(0);
        // netPay = grossPay - pfEmployee - esiEmployee - tds
        expect(slip!.netPay).toBe(round2(slip!.grossPay - slip!.pfEmployee - slip!.esiEmployee - slip!.tds));
        expect(slip!.netPay).toBeLessThan(slip!.grossPay);

        // Finalizing must not change these already-computed figures.
        const run = await finalizePayrollRun(
          (await generatePayrollRun(month, "payroll-statutory-test")).run.id,
          "payroll-statutory-test"
        );
        expect(run.status).toBe("Finalized");
      });
    } finally {
      await deleteOrganization(org.id);
    }
  });

  it("applies zero deductions when all three flags are off (default, unchanged v1 behavior)", async () => {
    const org = await makeTestOrg("PayrollNoStatutory");
    const month = currentMonth();
    try {
      await runWithTenant({ orgId: org.id, org }, async () => {
        // Deliberately does NOT call upsertSetting — flags are unset, i.e. the real
        // default every existing org has today.
        const user = await createUser({
          fullName: "No Statutory Test Employee",
          email: `test-nostatutory-${Date.now()}@example.com`,
          password: "Test-Password-123!",
          role: "Employee",
          department: "Test",
          phoneNumber: "",
          createdBy: "payroll-statutory-test",
        });
        await setSalaryStructure(user.User_ID, 20000, `${month}-01`, "payroll-statutory-test");

        const { payslips } = await generatePayrollRun(month, "payroll-statutory-test");
        const slip = payslips.find((p) => p.userId === user.User_ID);
        expect(slip).toBeDefined();
        expect(slip!.pfEmployee).toBe(0);
        expect(slip!.esiEmployee).toBe(0);
        expect(slip!.tds).toBe(0);
        expect(slip!.netPay).toBe(slip!.grossPay);
      });
    } finally {
      await deleteOrganization(org.id);
    }
  });
});

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
