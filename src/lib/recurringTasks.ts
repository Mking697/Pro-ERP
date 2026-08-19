import {
  appendModuleRow,
  findModuleRow,
  getModuleRows,
  recordToRow,
  updateModuleRow,
} from "@/lib/moduleSheets";
import { generateId } from "@/lib/id";

const MODULE_KEY = "RECURRING_TASKS";

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

export async function listRecurringTasks(): Promise<RecurringTaskRecord[]> {
  return getModuleRows<RecurringTaskRecord>(MODULE_KEY);
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
  const record: RecurringTaskRecord = {
    Recurring_ID: generateId("REC"),
    Task: input.task,
    Doer_ID: input.doerId,
    Assigned_By: input.assignedBy,
    Frequency: input.frequency,
    Assign_Date: input.assignDate,
    Status: "Active",
    Created_At: new Date().toISOString(),
  };

  await appendModuleRow(MODULE_KEY, recordToRow(MODULE_KEY, record));
  return record;
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
  const found = await findModuleRow<RecurringTaskRecord>(MODULE_KEY, 0, recurringId);
  if (!found) {
    throw new Error("Ye recurring rule nahi mila.");
  }

  const updated: RecurringTaskRecord = { ...found.record, Status: status };
  await updateModuleRow(MODULE_KEY, found.rowNumber, recordToRow(MODULE_KEY, updated));
  return updated;
}
