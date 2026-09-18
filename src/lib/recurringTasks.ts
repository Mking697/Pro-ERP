import type { InferSelectModel } from "drizzle-orm";
import { recurringTasks } from "@/db/schema";
import { insertRecord, listByOrg, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { istDayKey, parseStamp } from "@/lib/timestamp";

/**
 * Mirrors the pre-Postgres sheet row shape exactly (same field names, same PascalCase
 * casing) even though the persistence underneath is now the `recurring_tasks` Postgres
 * table — the goal is zero changes at the API routes, `src/lib/recurringGenerator.ts` and
 * the `/tasks` frontend, which all read `.Task`, `.Frequency`, `.Assign_Date`, etc. off
 * this type today.
 */
export interface RecurringTaskRecord {
  Recurring_ID: string;
  Task: string;
  Doer_ID: string;
  Assigned_By: string;
  Frequency: string;
  Assign_Date: string;
  Status: string;
  Created_At: string;
}

type RecurringTaskRow = InferSelectModel<typeof recurringTasks>;

function rowToRecord(row: RecurringTaskRow): RecurringTaskRecord {
  return {
    Recurring_ID: row.id,
    Task: row.task,
    Doer_ID: row.doerId,
    Assigned_By: row.assignedBy,
    Frequency: row.frequency,
    // recurringGenerator.ts's isScheduledToday()/daysBetween() build `${assignISO}T00:00:00Z`
    // straight out of this string and diff it against todayIST() — it must be a bare
    // `YYYY-MM-DD` IST calendar date, not a UTC instant's own date, or the schedule shifts
    // by a day for anyone assigning a rule outside UTC daytime hours. istDayKey() is the
    // same IST-calendar-day helper timestamp.ts already exposes for this exact purpose.
    Assign_Date: istDayKey(row.assignDate),
    Status: row.status,
    Created_At: row.createdAt.toISOString(),
  };
}

export async function listRecurringTasks(): Promise<RecurringTaskRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await listByOrg(recurringTasks, orgId);
  return rows.map(rowToRecord);
}

export async function listActiveRecurringTasks(): Promise<RecurringTaskRecord[]> {
  const all = await listRecurringTasks();
  return all.filter((r) => r.Status === "Active");
}

interface CreateRecurringTaskInput {
  task: string;
  doerId: string;
  assignedBy: string;
  frequency: string;
  assignDate: string;
}

export async function createRecurringTask(
  input: CreateRecurringTaskInput
): Promise<RecurringTaskRecord> {
  // parseStamp reads a bare `YYYY-MM-DD` (what a <input type="date"> submits) as an IST
  // wall-clock midnight — the inverse of istDayKey() above, so the round trip is exact.
  const assignDate = parseStamp(input.assignDate);
  if (!assignDate) {
    throw new Error("Assign Date samajh nahi aayi.");
  }

  const orgId = await getTenantOrgId();
  const row = await insertRecord(recurringTasks, {
    id: generateId("REC"),
    orgId,
    task: input.task,
    doerId: input.doerId,
    assignedBy: input.assignedBy,
    frequency: input.frequency,
    assignDate,
    status: "Active",
  });
  return rowToRecord(row);
}

export const RECURRING_STATUSES = ["Active", "Paused"] as const;
export type RecurringStatus = (typeof RECURRING_STATUSES)[number];

/**
 * Pauses or resumes a rule.
 *
 * Only `Active` rules generate occurrences (see listActiveRecurringTasks), so pausing
 * stops tomorrow's generation without deleting the rule or touching the occurrences it
 * has already produced — a rule is usually paused because the work is on hold, not
 * because its history was wrong.
 */
export async function setRecurringTaskStatus(
  recurringId: string,
  status: RecurringStatus
): Promise<RecurringTaskRecord> {
  const orgId = await getTenantOrgId();
  const updated = await updateById(recurringTasks, orgId, recurringId, { status });
  if (!updated) {
    throw new Error("Ye recurring rule nahi mila.");
  }
  return rowToRecord(updated);
}
