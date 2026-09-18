import type { InferSelectModel } from "drizzle-orm";
import { tasks } from "@/db/schema";
import { findById, insertRecord, listByOrg, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { parseStamp } from "@/lib/timestamp";

/**
 * Mirrors the pre-Postgres sheet row shape exactly (same field names, same PascalCase
 * casing) even though the persistence underneath is now the `tasks` Postgres table — the
 * goal is zero changes at the API routes, `src/lib/mis.ts`, `src/lib/recurringGenerator.ts`
 * and the `/tasks`/`/dashboard`/`/performance` frontends, which all read `.Title`,
 * `.Due_Date`, `.On_Time_Count`, etc. off this type today.
 */
export interface TaskRecord {
  Task_ID: string;
  Title: string;
  Description: string;
  Assigned_To: string;
  Assigned_By: string;
  Task_Type: string;
  Recurrence_Frequency: string;
  Due_Date: string;
  Attachment_URL: string;
  Status: string;
  Completed_At: string;
  Completion_Proof_URL: string;
  Remark: string;
  Created_At: string;
  On_Time_Count: string;
  Delay_Count: string;
  Priority: string;
  Recurring_ID: string;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * The exact inverse of `parseStamp`'s IST wall-clock reading: given the real instant
 * stored in Postgres, renders it back as `YYYY-MM-DDTHH:mm` IST — the same shape
 * `<input type="datetime-local">` submits and `formatDateTime()` produces.
 *
 * Deliberately NOT `toISOString()` (contrast `Created_At`/`Completed_At` below), because
 * `recurringGenerator.ts`'s `generateDueRecurringOccurrences()` — which this migration must
 * not touch — does a raw `task.Due_Date.startsWith(todayIST())` string-prefix check to
 * decide "was today's occurrence already generated". `todayIST()` is the IST calendar day;
 * a UTC ISO string's own leading `YYYY-MM-DD` only agrees with that for part of the day
 * (any due time between IST midnight and 5:30am would land on the *previous* UTC calendar
 * date). Recurring occurrences happen to always be due at 23:59 IST today, which would
 * never actually cross that boundary either way — but a one-time task's Due_Date has no
 * such guarantee, and this field's whole original contract was "whatever wall-clock string
 * a person typed, unconverted". Keeping it as an IST wall-clock string preserves that
 * contract exactly, independent of which particular times happen to be in use today.
 */
function toIstWallStamp(date: Date | null): string {
  if (!date) return "";
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}` +
    `T${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}`
  );
}

type TaskRow = InferSelectModel<typeof tasks>;

function rowToRecord(row: TaskRow): TaskRecord {
  return {
    Task_ID: row.id,
    Title: row.title,
    Description: row.description,
    Assigned_To: row.assignedTo,
    Assigned_By: row.assignedBy,
    Task_Type: row.taskType,
    Recurrence_Frequency: row.recurrenceFrequency,
    Due_Date: toIstWallStamp(row.dueDate),
    Attachment_URL: row.attachmentUrl,
    Status: row.status,
    Completed_At: row.completedAt ? row.completedAt.toISOString() : "",
    Completion_Proof_URL: row.completionProofUrl,
    Remark: row.remark,
    Created_At: row.createdAt.toISOString(),
    On_Time_Count: String(row.onTimeCount),
    Delay_Count: String(row.delayCount),
    Priority: row.priority,
    Recurring_ID: row.recurringId,
  };
}

export async function listTasks(): Promise<TaskRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await listByOrg(tasks, orgId);
  return rows.map(rowToRecord);
}

interface CreateTaskInput {
  title: string;
  description: string;
  assignedTo: string;
  assignedBy: string;
  priority: string;
  dueDate: string;
  attachmentUrl: string;
  remark: string;
}

/** Creates a one-off task. Recurring tasks are never created here — a Recurring_Tasks
 * definition (src/lib/recurringTasks.ts) generates each dated occurrence as its own row
 * via createRecurringOccurrence() instead. */
export async function createTask(input: CreateTaskInput): Promise<TaskRecord> {
  const orgId = await getTenantOrgId();
  const row = await insertRecord(tasks, {
    id: generateId("TSK"),
    orgId,
    title: input.title,
    description: input.description,
    assignedTo: input.assignedTo,
    assignedBy: input.assignedBy,
    priority: input.priority,
    taskType: "One-Time",
    recurrenceFrequency: "",
    dueDate: parseStamp(input.dueDate),
    attachmentUrl: input.attachmentUrl,
    status: "Pending",
    completionProofUrl: "",
    remark: input.remark,
    onTimeCount: 0,
    delayCount: 0,
    recurringId: "",
  });
  return rowToRecord(row);
}

interface CreateRecurringOccurrenceInput {
  recurringId: string;
  title: string;
  assignedTo: string;
  assignedBy: string;
  frequency: string;
  dueDate: string;
}

/** Appends one dated occurrence of a recurring task — called only by the daily generator. */
export async function createRecurringOccurrence(
  input: CreateRecurringOccurrenceInput
): Promise<TaskRecord> {
  const orgId = await getTenantOrgId();
  const row = await insertRecord(tasks, {
    id: generateId("TSK"),
    orgId,
    title: input.title,
    description: "",
    assignedTo: input.assignedTo,
    assignedBy: input.assignedBy,
    priority: "Medium",
    taskType: "Recurring",
    recurrenceFrequency: input.frequency,
    dueDate: parseStamp(input.dueDate),
    attachmentUrl: "",
    status: "Pending",
    completionProofUrl: "",
    remark: "",
    onTimeCount: 0,
    delayCount: 0,
    recurringId: input.recurringId,
  });
  return rowToRecord(row);
}

export async function markTaskDone(
  taskId: string,
  proofUrl: string,
  requestingUserId: string
): Promise<TaskRecord> {
  const orgId = await getTenantOrgId();
  const found = await findById(tasks, orgId, taskId);
  if (!found) {
    throw new Error("Task nahi mila.");
  }
  if (found.assignedTo !== requestingUserId) {
    throw new Error("Aap sirf apne assigned tasks complete kar sakte hain.");
  }
  if (found.status !== "Pending") {
    throw new Error("Yeh task pehle se complete ho chuka hai.");
  }

  const now = new Date();
  const isOnTime = !found.dueDate || now <= found.dueDate;

  const updated = await updateById(tasks, orgId, taskId, {
    status: isOnTime ? "Done on Time" : "Delay Done",
    completedAt: now,
    completionProofUrl: proofUrl,
    onTimeCount: found.onTimeCount + (isOnTime ? 1 : 0),
    delayCount: found.delayCount + (isOnTime ? 0 : 1),
  });
  if (!updated) {
    throw new Error("Task nahi mila.");
  }

  return rowToRecord(updated);
}
