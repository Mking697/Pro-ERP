import { and, asc, desc, eq, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { leads, orders, pdiInspections, tmsShipments, dispatches, leaves, invoices, bills,
  inwardIqcFms, failureLog, imsInward, indents, productionPlans, tasks, fmsRuns, users, bom, recurringTasks, payslips, payrollRuns } from "@/db/schema";
import { getTenantOrgId } from "@/lib/tenant";
import type { DateRange } from "@/lib/analytics";
import type { ReportScope, ReportViewer } from "@/lib/reports";

interface TimedStatus { createdAt: string; status: string }
interface ReportRows {
  leads: TimedStatus & { assignedTo: string; createdBy: string };
  orders: TimedStatus & { createdBy: string };
  pdi: TimedStatus & { passedBy: string };
  tms: TimedStatus & { createdBy: string };
  dispatch: TimedStatus & { assignedTo: string; createdBy: string };
  leave: TimedStatus & { doerId: string; filedBy: string; leaveType: string };
  invoices: TimedStatus;
  bills: TimedStatus;
  inward: { Timestamp: string; IQC_Status: string; Created_By: string };
  failures: { Timestamp: string; Fail_Qty: string; Fail_Reason: string; Verified_By: string };
  ims: { Timestamp: string; Pass_Qty: string; Party_Name: string; Verified_By: string };
  indents: { Timestamp: string; Status: string; Requested_By: string; Approved_By: string };
  ppc: { timestamp: string; status: string; productionDate: string; createdBy: string; startedBy: string };
}
const OWNER_TRIM_CHARACTERS = "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
const stamp = (c: AnyPgColumn) => sql<string>`${c}`.mapWith((value: string | Date | null) => value ? new Date(value).toISOString() : "");
type Projection = Record<string, AnyPgColumn | SQL>;
interface QueryDefinition { table: AnyPgTable; orgId: AnyPgColumn; date: AnyPgColumn; owners: AnyPgColumn[]; fields: Projection }
const definitions: Record<keyof ReportRows, QueryDefinition> = {
  leads: { table: leads, orgId: leads.orgId, date: leads.createdAt, owners: [leads.assignedTo, leads.createdBy], fields: { createdAt: stamp(leads.createdAt), status: leads.status, assignedTo: leads.assignedTo, createdBy: leads.createdBy } },
  orders: { table: orders, orgId: orders.orgId, date: orders.createdAt, owners: [orders.createdBy], fields: { createdAt: stamp(orders.createdAt), status: orders.status, createdBy: orders.createdBy } },
  pdi: { table: pdiInspections, orgId: pdiInspections.orgId, date: pdiInspections.createdAt, owners: [pdiInspections.passedBy], fields: { createdAt: stamp(pdiInspections.createdAt), status: pdiInspections.status, passedBy: pdiInspections.passedBy } },
  tms: { table: tmsShipments, orgId: tmsShipments.orgId, date: tmsShipments.createdAt, owners: [tmsShipments.createdBy], fields: { createdAt: stamp(tmsShipments.createdAt), status: tmsShipments.status, createdBy: tmsShipments.createdBy } },
  dispatch: { table: dispatches, orgId: dispatches.orgId, date: dispatches.createdAt, owners: [dispatches.assignedTo, dispatches.createdBy], fields: { createdAt: stamp(dispatches.createdAt), status: dispatches.status, assignedTo: dispatches.assignedTo, createdBy: dispatches.createdBy } },
  leave: { table: leaves, orgId: leaves.orgId, date: leaves.createdAt, owners: [leaves.doerId, leaves.filedBy], fields: { createdAt: stamp(leaves.createdAt), status: leaves.status, doerId: leaves.doerId, filedBy: leaves.filedBy, leaveType: leaves.leaveType } },
  invoices: { table: invoices, orgId: invoices.orgId, date: invoices.createdAt, owners: [], fields: { createdAt: stamp(invoices.createdAt), status: invoices.status } },
  bills: { table: bills, orgId: bills.orgId, date: bills.createdAt, owners: [], fields: { createdAt: stamp(bills.createdAt), status: bills.status } },
  inward: { table: inwardIqcFms, orgId: inwardIqcFms.orgId, date: inwardIqcFms.timestamp, owners: [inwardIqcFms.createdBy], fields: { Timestamp: stamp(inwardIqcFms.timestamp), IQC_Status: inwardIqcFms.iqcStatus, Created_By: inwardIqcFms.createdBy } },
  failures: { table: failureLog, orgId: failureLog.orgId, date: failureLog.timestamp, owners: [failureLog.verifiedBy], fields: { Timestamp: stamp(failureLog.timestamp), Fail_Qty: failureLog.failQty, Fail_Reason: failureLog.failReason, Verified_By: failureLog.verifiedBy } },
  ims: { table: imsInward, orgId: imsInward.orgId, date: imsInward.timestamp, owners: [imsInward.verifiedBy], fields: { Timestamp: stamp(imsInward.timestamp), Pass_Qty: imsInward.passQty, Party_Name: imsInward.partyName, Verified_By: imsInward.verifiedBy } },
  indents: { table: indents, orgId: indents.orgId, date: indents.timestamp, owners: [indents.requestedBy, indents.approvedBy], fields: { Timestamp: stamp(indents.timestamp), Status: indents.status, Requested_By: indents.requestedBy, Approved_By: indents.approvedBy } },
  ppc: { table: productionPlans, orgId: productionPlans.orgId, date: productionPlans.timestamp, owners: [productionPlans.createdBy, productionPlans.startedBy], fields: { timestamp: stamp(productionPlans.timestamp), status: productionPlans.status, productionDate: stamp(productionPlans.productionDate), createdBy: productionPlans.createdBy, startedBy: productionPlans.startedBy } },
};

/** Internal report-only projection. Caller gates report grants and resolves authorized scope.
 * Identical inclusive instant range / trimmed case-insensitive id-or-email ownership.
 * Chart inputs are complete inside that scope, never silently limited for a detail page. */
export async function readPerf04ReportRows<K extends keyof ReportRows>(kind: K, range: DateRange,
  scope: ReportScope, viewer: ReportViewer): Promise<ReportRows[K][]> {
  const orgId = await getTenantOrgId();
  const definition = definitions[kind];
  const owners = [viewer.userId, viewer.email].map(v => v.trim().toLowerCase()).filter(Boolean);
  const ownerFilter = scope === "mine" && definition.owners.length
    ? owners.length ? or(...definition.owners.flatMap(c => owners.map(owner => eq(sql`lower(btrim(${c}, ${OWNER_TRIM_CHARACTERS}))`, owner)))) : sql`false`
    : undefined;
  const rows = await db.select(definition.fields).from(definition.table).where(and(
    eq(definition.orgId, orgId),
    range.key === "all" ? undefined : and(gte(definition.date, range.from), lte(definition.date, range.to)),
    ownerFilter,
  ));
  return rows as unknown as ReportRows[K][];
}

import type { TaskRecord } from "@/lib/tasks";
import type { FmsRunRecord } from "@/lib/fms/engine";
import type { UserScoreRow } from "@/lib/analytics";

const inWindow = (column: AnyPgColumn, range: DateRange) => range.key === "all" ? undefined : and(gte(column, range.from), lte(column, range.to));
const taskFields = {
  Task_ID: tasks.id, Title: tasks.title, Assigned_To: tasks.assignedTo, Assigned_By: tasks.assignedBy,
  Due_Date: stamp(tasks.dueDate).as("due_date_input"), Status: tasks.status, Created_At: stamp(tasks.createdAt).as("task_created_at_input"),
  On_Time_Count: sql<string>`${tasks.onTimeCount}::text`.as("on_time_count_input"), Delay_Count: sql<string>`${tasks.delayCount}::text`.as("delay_count_input"),
  Priority: tasks.priority,
};
const fmsFields = {
  Run_ID: fmsRuns.id, Step_Name: fmsRuns.stepName, Template_Name: fmsRuns.templateName,
  Assigned_To: fmsRuns.assignedTo, Created_At: stamp(fmsRuns.createdAt).as("fms_created_at_input"),
  TAT_Deadline: stamp(fmsRuns.tatDeadline).as("tat_deadline_input"), Completed_At: stamp(fmsRuns.completedAt).as("completed_at_input"), Status: fmsRuns.status,
};
/** Internal chart/breakdown inputs only: unused description, attachment and form payloads
 * deliberately never transferred. The MIS helpers read only the projected properties. */
export async function readPerf04TaskInputs(range: DateRange, userId: string, delegated: boolean): Promise<TaskRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db.select(taskFields).from(tasks).where(and(eq(tasks.orgId, orgId), inWindow(tasks.createdAt, range),
    delegated ? or(eq(tasks.assignedTo, userId), eq(tasks.assignedBy, userId)) : eq(tasks.assignedTo, userId)));
  return rows as unknown as TaskRecord[];
}
export interface Perf04PerformanceData {
  charts: UserScoreRow[];
  rows: UserScoreRow[];
  tasks: TaskRecord[];
  fmsRuns: FmsRunRecord[];
  page: number;
  hasMore: boolean;
}
const PERFORMANCE_PAGE_SIZE = 25;
const DETAIL_ROWS_PER_USER = 20;

/** All chart/score totals are SQL aggregates of the complete requested window. Only
 * table users (25+lookahead) and their recent evaluated detail rows (20/source/user)
 * are paginated. Detail truncation is explicit in the UI; full CSV remains available. */
export async function readPerf04Performance(range: DateRange, requestedPage: number): Promise<Perf04PerformanceData> {
  const orgId = await getTenantOrgId();
  const page = Number.isInteger(requestedPage) ? Math.min(1000, Math.max(0, requestedPage)) : 0;
  const now = new Date();
  const taskScores = db.select({ userId: tasks.assignedTo,
    onTime: sql<number>`sum(${tasks.onTimeCount})`.as("on_time"),
    delay: sql<number>`sum(${tasks.delayCount})`.as("delay"),
    notDone: sql<number>`count(*) filter (where ${tasks.status} = 'Pending' and ${tasks.dueDate} < ${now})`.as("not_done"),
  }).from(tasks).where(and(eq(tasks.orgId, orgId), inWindow(tasks.createdAt, range))).groupBy(tasks.assignedTo).as("task_scores");
  const fmsScores = db.select({ userId: fmsRuns.assignedTo,
    onTime: sql<number>`count(*) filter (where ${fmsRuns.status} = 'On Time')`.as("on_time"),
    delay: sql<number>`count(*) filter (where ${fmsRuns.status} = 'Delay Done')`.as("delay"),
    notDone: sql<number>`count(*) filter (where ${fmsRuns.status} = 'Pending' and ${fmsRuns.tatDeadline} < ${now})`.as("not_done"),
  }).from(fmsRuns).where(and(eq(fmsRuns.orgId, orgId), inWindow(fmsRuns.createdAt, range))).groupBy(fmsRuns.assignedTo).as("fms_scores");
  const onTime = sql<number>`coalesce(${taskScores.onTime},0) + coalesce(${fmsScores.onTime},0)`.mapWith(Number);
  const delay = sql<number>`coalesce(${taskScores.delay},0) + coalesce(${fmsScores.delay},0)`.mapWith(Number);
  const notDone = sql<number>`coalesce(${taskScores.notDone},0) + coalesce(${fmsScores.notDone},0)`.mapWith(Number);
  const evaluated = sql`(${onTime}) + (${delay}) + (${notDone})`;
  const scoreOrder = sql`case when (${evaluated}) > 0 then -round(((${delay}) * 0.5 + (${notDone})) / (${evaluated}) * 100) else 1 end`;
  const query = () => db.select({ userId: users.id, name: users.fullName, role: users.role, department: users.department, onTime, delay, notDone })
    .from(users).leftJoin(taskScores, eq(taskScores.userId, users.id)).leftJoin(fmsScores, eq(fmsScores.userId, users.id))
    .where(and(eq(users.orgId, orgId), eq(users.status, "Active"))).orderBy(scoreOrder, asc(users.id));
  const [all, paged] = await Promise.all([query(), query().limit(PERFORMANCE_PAGE_SIZE + 1).offset(page * PERFORMANCE_PAGE_SIZE)]);
  const toScore = (row: typeof all[number]): UserScoreRow => {
    const totalEvaluated = row.onTime + row.delay + row.notDone;
    const penalty = row.delay * 0.5 + row.notDone;
    return { userId: row.userId, name: row.name, role: row.role, department: row.department,
      summary: { onTime: row.onTime, delay: row.delay, notDone: row.notDone, totalEvaluated, penalty,
        score: totalEvaluated ? -Math.round(penalty / totalEvaluated * 100) : null } };
  };
  const rows = paged.slice(0, PERFORMANCE_PAGE_SIZE).map(toScore);
  const ids = rows.map(r => r.userId);
  if (!ids.length) return { charts: all.map(toScore), rows, tasks: [], fmsRuns: [], page, hasMore: false };
  const taskDetail = db.select({ ...taskFields,
    rowNo: sql<number>`row_number() over (partition by ${tasks.assignedTo} order by ${tasks.createdAt} desc, ${tasks.id} desc)`.as("row_no"),
  }).from(tasks).where(and(eq(tasks.orgId, orgId), inWindow(tasks.createdAt, range), inArray(tasks.assignedTo, ids),
    or(sql`${tasks.onTimeCount} > 0`, sql`${tasks.delayCount} > 0`, sql`${tasks.status} = 'Pending' and ${tasks.dueDate} < ${now}`))).as("task_detail");
  const fmsDetail = db.select({ ...fmsFields,
    rowNo: sql<number>`row_number() over (partition by ${fmsRuns.assignedTo} order by ${fmsRuns.createdAt} desc, ${fmsRuns.id} desc)`.as("row_no"),
  }).from(fmsRuns).where(and(eq(fmsRuns.orgId, orgId), inWindow(fmsRuns.createdAt, range), inArray(fmsRuns.assignedTo, ids),
    or(inArray(fmsRuns.status, ["On Time", "Delay Done"]), sql`${fmsRuns.status} = 'Pending' and ${fmsRuns.tatDeadline} < ${now}`))).as("fms_detail");
  const [taskRows, fmsRows] = await Promise.all([
    db.select().from(taskDetail).where(lte(taskDetail.rowNo, DETAIL_ROWS_PER_USER)).orderBy(asc(taskDetail.Assigned_To), asc(taskDetail.rowNo)),
    db.select().from(fmsDetail).where(lte(fmsDetail.rowNo, DETAIL_ROWS_PER_USER)).orderBy(asc(fmsDetail.Assigned_To), asc(fmsDetail.rowNo)),
  ]);
  return { charts: all.map(toScore), rows, tasks: taskRows as unknown as TaskRecord[], fmsRuns: fmsRows as unknown as FmsRunRecord[], page, hasMore: paged.length > PERFORMANCE_PAGE_SIZE };
}

function ownedSql(columns: AnyPgColumn[], scope: ReportScope, viewer: ReportViewer): SQL | undefined {
  if (scope !== "mine" || !columns.length) return undefined;
  const identities = [viewer.userId, viewer.email].map(v => v.trim().toLowerCase()).filter(Boolean);
  if (!identities.length) return sql`false`;
  return or(...columns.flatMap(column => identities.map(identity => eq(sql`lower(btrim(${column}, ${OWNER_TRIM_CHARACTERS}))`, identity))));
}
export async function readPerf04Recurring(scope: ReportScope, viewer: ReportViewer) {
  const orgId = await getTenantOrgId();
  const where = and(eq(recurringTasks.orgId, orgId), ownedSql([recurringTasks.assignedBy], scope, viewer));
  const [statuses, frequencies] = await Promise.all([
    db.select({ label: recurringTasks.status, value: sql<number>`count(*)`.mapWith(Number) }).from(recurringTasks).where(where).groupBy(recurringTasks.status),
    db.select({ frequency: recurringTasks.frequency, value: sql<number>`count(*)`.mapWith(Number) }).from(recurringTasks).where(where).groupBy(recurringTasks.frequency),
  ]);
  return { statuses, frequencies };
}
export async function readPerf04Boms(scope: ReportScope, viewer: ReportViewer) {
  const orgId = await getTenantOrgId();
  const where = and(eq(bom.orgId, orgId), ownedSql([bom.createdBy], scope, viewer));
  const [statuses, active] = await Promise.all([
    db.select({ label: bom.status, value: sql<number>`count(distinct ${bom.bomId})`.mapWith(Number) }).from(bom).where(where).groupBy(bom.status),
    db.select({ productName: bom.productName, lineCount: sql<number>`count(*) filter (where ${bom.componentSku} <> '')`.mapWith(Number) }).from(bom)
      .where(and(where, eq(bom.status, "Active"))).groupBy(bom.bomId, bom.productName)
      .orderBy(sql`max(${bom.createdAt}) desc`, desc(bom.bomId)).limit(10),
  ]);
  return { statuses, active };
}
export async function readPerf04Payroll(range: DateRange, userId: string) {
  const orgId = await getTenantOrgId();
  const base = and(eq(payslips.orgId, orgId), eq(payrollRuns.orgId, orgId), eq(payslips.userId, userId), eq(payrollRuns.status, "Finalized"));
  const query = (window?: DateRange) => db.select({ month: payrollRuns.month, createdAt: stamp(payslips.createdAt),
    grossPay: sql<number>`${payslips.grossPay}`.mapWith(Number), netPay: sql<number>`${payslips.netPay}`.mapWith(Number) })
    .from(payslips).innerJoin(payrollRuns, eq(payslips.payrollRunId, payrollRuns.id))
    .where(and(base, window ? inWindow(payslips.createdAt, window) : undefined)).orderBy(desc(payrollRuns.month), desc(payslips.id));
  const [history, latestRows] = await Promise.all([query(range).limit(12), query().limit(1)]);
  return { history, latest: latestRows[0] ?? null };
}


