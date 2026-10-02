import {
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * Payroll — v1 was simple by explicit user choice (no PF/ESI/TDS); as of 2026-10-02,
 * optional statutory deduction calculation (PF/ESI/TDS) exists — see
 * src/lib/payroll/statutory.ts for the real formulas and their documented
 * simplifications — gated per-org behind Settings (PF_ENABLED/ESI_ENABLED/TDS_ENABLED),
 * all OFF by default so no existing org's payroll numbers change unless they opt in.
 * There is no clock-in/clock-out or biometric attendance module anywhere in this
 * codebase, so "attendance" here still means join/exit-date proration within the month,
 * not daily presence — a user created or deactivated partway through a month is paid
 * only for the days they were an Active employee. Approved Leave does NOT reduce pay
 * (that is the entire point of the annual leave quota now existing — it is paid time off
 * up to that quota); a real unpaid-leave/absence deduction is a natural v2 extension once
 * this codebase has any way to know a day was genuinely unpaid, which it does not yet.
 */
export const salaryStructures = pgTable(
  "salary_structures",
  {
    // Salary_ID, e.g. "SAL-xxxx".
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id").notNull(),
    monthlySalary: numeric("monthly_salary").notNull().default("0"),
    // A raise mints a new row rather than overwriting this one — same "never mutate a
    // historical fact" reasoning as fms_templates/bom versioning — so a payroll run for a
    // past month always resolves against the salary that was actually in effect then.
    effectiveFrom: date("effective_from").notNull(),
    createdBy: text("created_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("salary_structures_org_id_user_id_idx").on(table.orgId, table.userId)]
);

export const payrollRunStatusEnum = pgEnum("payroll_run_status", ["Draft", "Finalized"]);

/** One row per calendar month per org — generating twice for the same month updates the
 * same run (its payslips are replaced) rather than creating a duplicate. */
export const payrollRuns = pgTable(
  "payroll_runs",
  {
    // Payroll_Run_ID, e.g. "PYR-xxxx".
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    // "2026-09" — a calendar month, not a date.
    month: text("month").notNull(),
    status: payrollRunStatusEnum("status").notNull().default("Draft"),
    generatedBy: text("generated_by").notNull().default(""),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    // Finalizing is a deliberate human action (mirrors an invoice's Draft->Issued step) —
    // a Draft run can be regenerated freely as salary structures/joiners/exits change
    // during the month; a Finalized one is the org's real record and stays put.
    finalizedBy: text("finalized_by").notNull().default(""),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  },
  (table) => [unique("payroll_runs_org_id_month_unique").on(table.orgId, table.month)]
);

/** One row per user per payroll run — every figure is a snapshot at generation time
 * (the salary that was in effect, the days actually worked that month), so a later salary
 * change never rewrites history the way `invoices.finalValue` already doesn't for orders. */
export const payslips = pgTable(
  "payslips",
  {
    // Payslip_ID, e.g. "PYS-xxxx".
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    payrollRunId: text("payroll_run_id").notNull(),
    userId: text("user_id").notNull(),
    monthlySalary: numeric("monthly_salary").notNull().default("0"),
    daysInMonth: integer("days_in_month").notNull(),
    // Days this user was an Active employee during this month (join/exit-date prorated).
    daysEmployed: integer("days_employed").notNull(),
    grossPay: numeric("gross_pay").notNull().default("0"),
    // Statutory deductions — all zero unless the org has opted in via Settings
    // (PF_ENABLED/ESI_ENABLED/TDS_ENABLED; see src/lib/payroll/statutory.ts for the real
    // formulas and their documented simplifications). Employee-side amounts are deducted
    // from netPay below; employer-side amounts are the org's own cost and never touch
    // netPay, but are stored so a payslip/report can show the org's full employer cost.
    pfEmployee: numeric("pf_employee").notNull().default("0"),
    pfEmployer: numeric("pf_employer").notNull().default("0"),
    esiEmployee: numeric("esi_employee").notNull().default("0"),
    esiEmployer: numeric("esi_employer").notNull().default("0"),
    tds: numeric("tds").notNull().default("0"),
    // grossPay minus pfEmployee, esiEmployee, and tds — equals grossPay when none of the
    // three statutory settings are enabled (v1's exact prior behavior, unchanged for any
    // org that never opts in).
    netPay: numeric("net_pay").notNull().default("0"),
    pdfUrl: text("pdf_url").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("payslips_payroll_run_id_user_id_unique").on(table.payrollRunId, table.userId),
    index("payslips_org_id_user_id_idx").on(table.orgId, table.userId),
  ]
);
