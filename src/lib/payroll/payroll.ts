import { and, eq, inArray, type InferSelectModel } from "drizzle-orm";
import { db } from "@/db/client";
import { payrollRuns, payslips, salaryStructures } from "@/db/schema";
import { findById, listByOrg, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { listUsers } from "@/lib/auth/users";
import { getOrganization } from "@/lib/platform/registry";
import { getSetting } from "@/lib/settings";
import { uploadAttachment } from "@/lib/storage";

/**
 * Payroll v1 — simple, explicitly NOT statutory-compliant (see src/db/schema/payroll.ts's
 * own header comment for the full reasoning: no PF/ESI/TDS, no unpaid-leave deduction,
 * Approved Leave never reduces pay).
 *
 * "Attendance" proration, precisely: there is no clock-in/clock-out or biometric presence
 * anywhere in this codebase. `users.deactivatedAt` (added for this exact purpose) records
 * the moment Status last genuinely flipped Active -> Inactive (set/cleared by
 * `updateUser()` in src/lib/auth/users.ts, only on a real transition), so
 * `daysEmployed` can now prorate an exit within the month instead of just zeroing it:
 *
 *   - A user who is Active at the moment a run is generated is paid for every day of the
 *     month from `max(1st of month, their own users.createdAt date)` through the last day
 *     of the month — i.e. join-date proration only. A user who joined before the month
 *     started is paid the full month. Unchanged.
 *   - A user who is Inactive at the moment a run is generated, with a `deactivatedAt` that
 *     falls on or after this month's 1st, is paid from their own join date (or the 1st,
 *     whichever is later) through the deactivation date **inclusive** — the same
 *     inclusive convention `createdAt`'s own start-day already uses, so a join day and an
 *     exit day are both treated as one full paid day by symmetry.
 *   - A user who is Inactive with no `deactivatedAt` set, or one that falls before this
 *     month started, gets `daysEmployed = 0` for the run — correct when they genuinely
 *     weren't active at all this month, and the honest (still imperfect) fallback for a
 *     pre-existing Inactive user whose real exit date predates this column's existence and
 *     was never captured. This is the one remaining edge case this proration doesn't
 *     solve — it is not, and doesn't claim to be, fully statutory-accurate (no PF/ESI/TDS,
 *     that's explicitly separate, unscoped, future work).
 *   - Once a run is Finalized, its payslips are a frozen historical snapshot (Finalized
 *     runs refuse regeneration outright), so any of the above only ever affects a Draft
 *     run made near real time.
 */

export class PayrollError extends Error {}

type SalaryStructureRow = InferSelectModel<typeof salaryStructures>;
type PayrollRunRow = InferSelectModel<typeof payrollRuns>;
type PayslipRow = InferSelectModel<typeof payslips>;

export interface SalaryStructureRecord {
  id: string;
  userId: string;
  monthlySalary: number;
  effectiveFrom: string;
  createdBy: string;
  createdAt: string;
}

export type PayrollRunStatus = "Draft" | "Finalized";

export interface PayrollRunRecord {
  id: string;
  month: string;
  status: PayrollRunStatus;
  generatedBy: string;
  generatedAt: string;
  finalizedBy: string;
  finalizedAt: string | null;
}

export interface PayslipRecord {
  id: string;
  payrollRunId: string;
  userId: string;
  monthlySalary: number;
  daysInMonth: number;
  daysEmployed: number;
  grossPay: number;
  netPay: number;
  pdfUrl: string;
  createdAt: string;
}

export interface PayslipWithUser extends PayslipRecord {
  userFullName: string;
}

export interface PayslipWithRun extends PayslipRecord {
  month: string;
  runStatus: PayrollRunStatus;
}

export interface UserSalaryInfo {
  userId: string;
  fullName: string;
  role: string;
  status: string;
  currentSalary: number | null;
  effectiveFrom: string | null;
}

function rowToSalaryStructure(row: SalaryStructureRow): SalaryStructureRecord {
  return {
    id: row.id,
    userId: row.userId,
    monthlySalary: Number(row.monthlySalary),
    effectiveFrom: row.effectiveFrom,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToRun(row: PayrollRunRow): PayrollRunRecord {
  return {
    id: row.id,
    month: row.month,
    status: row.status,
    generatedBy: row.generatedBy,
    generatedAt: row.generatedAt.toISOString(),
    finalizedBy: row.finalizedBy,
    finalizedAt: row.finalizedAt ? row.finalizedAt.toISOString() : null,
  };
}

function rowToPayslip(row: PayslipRow): PayslipRecord {
  return {
    id: row.id,
    payrollRunId: row.payrollRunId,
    userId: row.userId,
    monthlySalary: Number(row.monthlySalary),
    daysInMonth: row.daysInMonth,
    daysEmployed: row.daysEmployed,
    grossPay: Number(row.grossPay),
    netPay: Number(row.netPay),
    pdfUrl: row.pdfUrl,
    createdAt: row.createdAt.toISOString(),
  };
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "Most recently effective, and among same-day ties, most recently created" — a plain
 * `effectiveFrom` string sort alone breaks when two rows share the same effective date
 * (e.g. two raises both dated today's fixed month-start convention): the underlying
 * `db.select()` carries no defined row order, so a bare date-only sort's tie behaviour
 * depends on whatever order Postgres happened to return rows in, not on which one was
 * actually entered later. `createdAt` (a real, monotonic insert timestamp) breaks the tie
 * deterministically in the caller's favour: the salary structure entered most recently
 * always wins among same-day ties. */
function compareSalaryRowsDesc(a: SalaryStructureRow, b: SalaryStructureRow): number {
  const byDate = b.effectiveFrom.localeCompare(a.effectiveFrom);
  if (byDate !== 0) return byDate;
  return b.createdAt.getTime() - a.createdAt.getTime();
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertMonthFormat(month: string): void {
  if (!MONTH_RE.test(month)) {
    throw new PayrollError(`"${month}" ek valid month nahi hai — "YYYY-MM" format use karein.`);
  }
}

// ---------------------------------------------------------------------------------------
// Salary structures
// ---------------------------------------------------------------------------------------

export async function setSalaryStructure(
  userId: string,
  monthlySalary: number,
  effectiveFrom: string,
  createdBy: string
): Promise<SalaryStructureRecord> {
  if (!userId) throw new PayrollError("User select karein.");
  if (!Number.isFinite(monthlySalary) || monthlySalary <= 0) {
    throw new PayrollError("Monthly salary 0 se zyada honi chahiye.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    throw new PayrollError("Effective From date 'YYYY-MM-DD' format me hona chahiye.");
  }

  const orgId = await getTenantOrgId();
  const [row] = await db
    .insert(salaryStructures)
    .values({
      id: generateId("SAL"),
      orgId,
      userId,
      monthlySalary: String(monthlySalary),
      effectiveFrom,
      createdBy,
    })
    .returning();
  return rowToSalaryStructure(row);
}

/** The most recent salary_structures row for `userId` with `effectiveFrom <= asOfDate`
 * (default: today) — a raise mints a new row rather than mutating the old one, so a past
 * month's payroll always resolves against whatever was actually in effect then. */
export async function getCurrentSalary(
  userId: string,
  asOfDate?: string
): Promise<SalaryStructureRecord | null> {
  const orgId = await getTenantOrgId();
  const asOf = asOfDate ?? todayDateOnly();
  const rows = await db
    .select()
    .from(salaryStructures)
    .where(and(eq(salaryStructures.orgId, orgId), eq(salaryStructures.userId, userId)));
  const eligible = rows
    .filter((r) => r.effectiveFrom <= asOf)
    .sort(compareSalaryRowsDesc);
  return eligible[0] ? rowToSalaryStructure(eligible[0]) : null;
}

/** Every user, with their currently-effective salary (or null if none has been set yet) —
 * backs the admin console's own salary-structure table. */
export async function listUsersWithCurrentSalary(): Promise<UserSalaryInfo[]> {
  const orgId = await getTenantOrgId();
  const [allUsers, allSalaryRows] = await Promise.all([
    listUsers(),
    db.select().from(salaryStructures).where(eq(salaryStructures.orgId, orgId)),
  ]);
  const today = todayDateOnly();

  return allUsers.map((u) => {
    const eligible = allSalaryRows
      .filter((r) => r.userId === u.User_ID && r.effectiveFrom <= today)
      .sort(compareSalaryRowsDesc);
    const current = eligible[0];
    return {
      userId: u.User_ID,
      fullName: u.Full_Name,
      role: u.Role,
      status: u.Status,
      currentSalary: current ? Number(current.monthlySalary) : null,
      effectiveFrom: current ? current.effectiveFrom : null,
    };
  });
}

// ---------------------------------------------------------------------------------------
// Payroll runs / payslip generation
// ---------------------------------------------------------------------------------------

async function findRunByMonth(orgId: string, month: string): Promise<PayrollRunRow | null> {
  const rows = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.orgId, orgId), eq(payrollRuns.month, month)))
    .limit(1);
  return rows[0] ?? null;
}

/** Calendar days actually in "YYYY-MM" — 28/29/30/31, real month-end aware. */
function daysInCalendarMonth(year: number, monthNum: number): number {
  return new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
}

/** See this file's header comment for the exact, deliberately pragmatic proration rule. */
function computeDaysEmployed(params: {
  status: string;
  createdAt: Date;
  deactivatedAt: Date | null;
  monthStartUTC: number;
  monthEndUTC: number;
  daysInMonth: number;
}): number {
  const { status, createdAt, deactivatedAt, monthStartUTC, monthEndUTC, daysInMonth } = params;

  const msPerDay = 24 * 60 * 60 * 1000;
  const dateOnlyUTC = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const createdDateOnly = dateOnlyUTC(createdAt);

  let employedEnd = monthEndUTC;
  if (status !== "Active") {
    if (!deactivatedAt) return 0; // legacy Inactive user, no exit date ever captured
    const deactivatedDateOnly = dateOnlyUTC(deactivatedAt);
    if (deactivatedDateOnly < monthStartUTC) return 0; // exited before this month started
    // Deactivation day itself counts as a full paid day, mirroring createdAt's own
    // inclusive start-day convention below.
    employedEnd = Math.min(monthEndUTC, deactivatedDateOnly);
  }

  const employedStart = Math.max(createdDateOnly, monthStartUTC);
  if (employedStart > employedEnd) return 0; // joined after the employed window entirely

  const days = Math.floor((employedEnd - employedStart) / msPerDay) + 1;
  return Math.min(days, daysInMonth);
}

/**
 * Finds or creates the Draft payroll_runs row for `month`, computes one payslip per user
 * who has a salary structure effective by the end of that month, and upserts them —
 * calling this twice for the same still-Draft month replaces its payslips (same run,
 * same payslip rows keyed by (payrollRunId, userId)) rather than duplicating anything.
 * Refuses outright if the run for that month is already Finalized.
 */
export async function generatePayrollRun(
  month: string,
  generatedBy: string
): Promise<{ run: PayrollRunRecord; payslips: PayslipRecord[] }> {
  assertMonthFormat(month);
  const orgId = await getTenantOrgId();

  let runRow = await findRunByMonth(orgId, month);
  if (runRow && runRow.status === "Finalized") {
    throw new PayrollError(
      `${month} ka payroll run pehle se Finalized hai — dobara generate nahi ho sakta.`
    );
  }

  if (!runRow) {
    const inserted = await db
      .insert(payrollRuns)
      .values({ id: generateId("PYR"), orgId, month, status: "Draft", generatedBy })
      .onConflictDoNothing({ target: [payrollRuns.orgId, payrollRuns.month] })
      .returning();
    runRow = inserted[0] ?? (await findRunByMonth(orgId, month));
    if (!runRow) {
      throw new PayrollError("Payroll run create nahi ho paya. Dobara try karein.");
    }
    if (runRow.status === "Finalized") {
      // Lost a race against a concurrent finalize between our insert attempt and re-read.
      throw new PayrollError(
        `${month} ka payroll run pehle se Finalized hai — dobara generate nahi ho sakta.`
      );
    }
  } else {
    const updated = await updateById(payrollRuns, orgId, runRow.id, {
      generatedBy,
      generatedAt: new Date(),
    });
    runRow = updated ?? runRow;
  }

  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthNum = Number(monthStr);
  const daysInMonth = daysInCalendarMonth(year, monthNum);
  const monthStartUTC = Date.UTC(year, monthNum - 1, 1);
  const monthEndUTC = Date.UTC(year, monthNum - 1, daysInMonth);
  const monthEndStr = new Date(monthEndUTC).toISOString().slice(0, 10);

  const [allUsers, allSalaryRows] = await Promise.all([
    listUsers(),
    db.select().from(salaryStructures).where(eq(salaryStructures.orgId, orgId)),
  ]);

  const byUser = new Map<string, SalaryStructureRow[]>();
  for (const row of allSalaryRows) {
    if (row.effectiveFrom > monthEndStr) continue; // not yet effective by month end
    const arr = byUser.get(row.userId) ?? [];
    arr.push(row);
    byUser.set(row.userId, arr);
  }

  const runId = runRow.id;
  const resultRows = await Promise.all(
    Array.from(byUser.entries()).map(async ([userId, rows]) => {
      const user = allUsers.find((u) => u.User_ID === userId);
      // The user row is gone (deleted since the salary structure was set) — nothing to pay.
      if (!user) return null;

      rows.sort(compareSalaryRowsDesc);
      const monthlySalary = Number(rows[0].monthlySalary);

      const daysEmployed = computeDaysEmployed({
        status: user.Status,
        createdAt: new Date(user.Created_At),
        deactivatedAt: user.Deactivated_At ? new Date(user.Deactivated_At) : null,
        monthStartUTC,
        monthEndUTC,
        daysInMonth,
      });
      const grossPay = round2((monthlySalary * daysEmployed) / daysInMonth);
      const netPay = grossPay; // no deductions exist yet — see payslips.netPay's own comment

      const [row] = await db
        .insert(payslips)
        .values({
          id: generateId("PYS"),
          orgId,
          payrollRunId: runId,
          userId,
          monthlySalary: String(monthlySalary),
          daysInMonth,
          daysEmployed,
          grossPay: String(grossPay),
          netPay: String(netPay),
        })
        .onConflictDoUpdate({
          target: [payslips.payrollRunId, payslips.userId],
          set: {
            monthlySalary: String(monthlySalary),
            daysInMonth,
            daysEmployed,
            grossPay: String(grossPay),
            netPay: String(netPay),
          },
        })
        .returning();
      return row;
    })
  );

  const currentPayslips = resultRows.filter((r): r is PayslipRow => r !== null);

  // A regeneration that drops a user (their salary structure was deleted, or the user
  // itself was deleted) must not leave a stale payslip behind from the previous run.
  const keepIds = new Set(currentPayslips.map((r) => r.id));
  const existing = await db
    .select()
    .from(payslips)
    .where(and(eq(payslips.orgId, orgId), eq(payslips.payrollRunId, runId)));
  const staleIds = existing.filter((r) => !keepIds.has(r.id)).map((r) => r.id);
  if (staleIds.length > 0) {
    await db.delete(payslips).where(and(eq(payslips.orgId, orgId), inArray(payslips.id, staleIds)));
  }

  return {
    run: rowToRun(runRow),
    payslips: currentPayslips.map(rowToPayslip),
  };
}

export async function finalizePayrollRun(
  runId: string,
  finalizedBy: string
): Promise<PayrollRunRecord> {
  const orgId = await getTenantOrgId();
  const run = await findById(payrollRuns, orgId, runId);
  if (!run) throw new PayrollError("Payroll run nahi mila.");
  if (run.status === "Finalized") {
    throw new PayrollError("Ye payroll run pehle se Finalized hai.");
  }

  const updated = await updateById(payrollRuns, orgId, runId, {
    status: "Finalized",
    finalizedBy,
    finalizedAt: new Date(),
  });
  if (!updated) throw new PayrollError("Payroll run finalize nahi ho paya.");

  // Payslip PDFs are generated here (Finalized only, never on a Draft regenerate, so a
  // run edited several times mid-month never wastes an upload per edit) and are
  // best-effort — mirrors notifyStepComplete's own convention: the run's numbers just
  // committed successfully above, and a PDF-rendering or Blob-upload failure must never
  // undo or block that. A payslip left with an empty pdfUrl can be told apart from a
  // Draft one by whether `run.status === "Finalized"`, and the org's records already
  // exist in the payslip row itself either way.
  try {
    await generatePayslipPdfs(orgId, runId);
  } catch (error) {
    console.error(`[payroll] payslip PDF generation failed for run ${runId}:`, error);
  }

  return rowToRun(updated);
}

async function generatePayslipPdfs(orgId: string, runId: string): Promise<void> {
  const [run, rows, allUsers, org, logoUrl] = await Promise.all([
    findById(payrollRuns, orgId, runId),
    db.select().from(payslips).where(and(eq(payslips.orgId, orgId), eq(payslips.payrollRunId, runId))),
    listUsers(),
    getOrganization(orgId),
    getSetting("ORG_LOGO_URL").catch(() => null),
  ]);
  if (!run) return;

  const { renderPayslipPdfBuffer } = await import("@/lib/payroll/payslipPdf");

  await Promise.all(
    rows.map(async (row) => {
      const user = allUsers.find((u) => u.User_ID === row.userId);
      const buffer = await renderPayslipPdfBuffer({
        companyName: org?.orgName ?? "Pro ERP",
        logoUrl: logoUrl ?? "",
        month: run.month,
        employeeName: user?.Full_Name ?? row.userId,
        monthlySalary: Number(row.monthlySalary),
        daysInMonth: row.daysInMonth,
        daysEmployed: row.daysEmployed,
        grossPay: Number(row.grossPay),
        netPay: Number(row.netPay),
      });

      const { url } = await uploadAttachment({
        fileName: `Payslip_${run.month}_${row.userId}.pdf`,
        mimeType: "application/pdf",
        buffer,
      });

      await db
        .update(payslips)
        .set({ pdfUrl: url })
        .where(and(eq(payslips.orgId, orgId), eq(payslips.id, row.id)));
    })
  );
}

// ---------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------

/** Every Finalized payslip for one user, across every run — "My Payslips". A Draft run's
 * numbers can still change before it's finalized, so it is deliberately left out here;
 * the admin console reads a Draft run's own payslips via getPayrollRun() instead. */
export async function listPayslipsForUser(userId: string): Promise<PayslipWithRun[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select({ payslip: payslips, run: payrollRuns })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payslips.payrollRunId, payrollRuns.id))
    .where(
      and(
        eq(payslips.orgId, orgId),
        eq(payrollRuns.orgId, orgId),
        eq(payslips.userId, userId),
        eq(payrollRuns.status, "Finalized")
      )
    );

  return rows
    .map(({ payslip, run }) => ({
      ...rowToPayslip(payslip),
      month: run.month,
      runStatus: run.status,
    }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

export async function listPayrollRuns(): Promise<PayrollRunRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await listByOrg(payrollRuns, orgId);
  return rows.map(rowToRun).sort((a, b) => b.month.localeCompare(a.month));
}

export async function getPayrollRun(
  runId: string
): Promise<{ run: PayrollRunRecord; payslips: PayslipWithUser[] } | null> {
  const orgId = await getTenantOrgId();
  const run = await findById(payrollRuns, orgId, runId);
  if (!run) return null;

  const [rows, allUsers] = await Promise.all([
    db.select().from(payslips).where(and(eq(payslips.orgId, orgId), eq(payslips.payrollRunId, runId))),
    listUsers(),
  ]);
  const nameOf = (id: string) => allUsers.find((u) => u.User_ID === id)?.Full_Name ?? id;

  return {
    run: rowToRun(run),
    payslips: rows
      .map((r) => ({ ...rowToPayslip(r), userFullName: nameOf(r.userId) }))
      .sort((a, b) => a.userFullName.localeCompare(b.userFullName)),
  };
}
