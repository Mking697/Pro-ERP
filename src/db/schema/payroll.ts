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
 * Payroll — simple v1, by explicit user choice over a full statutory-compliance system
 * (no PF/ESI/TDS; that is a separate, later conversation). There is no clock-in/clock-out
 * or biometric attendance module anywhere in this codebase, so "attendance" here means
 * join/exit-date proration within the month, not daily presence — a user created or
 * deactivated partway through a month is paid only for the days they were an Active
 * employee. Approved Leave does NOT reduce pay (that is the entire point of the annual
 * leave quota now existing — it is paid time off up to that quota); a real unpaid-leave/
 * absence deduction is a natural v2 extension once this codebase has any way to know a day
 * was genuinely unpaid, which it does not yet.
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
    // Equals grossPay in v1 — no deductions exist yet (PF/ESI/TDS are a separate, later
    // conversation). Kept as its own column now so a v2 deduction never has to rename or
    // repurpose grossPay's own meaning.
    netPay: numeric("net_pay").notNull().default("0"),
    pdfUrl: text("pdf_url").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("payslips_payroll_run_id_user_id_unique").on(table.payrollRunId, table.userId),
    index("payslips_org_id_user_id_idx").on(table.orgId, table.userId),
  ]
);
