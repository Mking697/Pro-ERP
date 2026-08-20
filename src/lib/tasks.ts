import {
  appendModuleRow,
  getModuleRows,
  updateModuleRow,
  findModuleRow,
  recordToRow,
} from "@/lib/moduleSheets";
import { generateId } from "@/lib/id";
import { nowStamp, parseStamp } from "@/lib/timestamp";

const MODULE_KEY = "TASKS";

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

function taskToRow(task: TaskRecord): string[] {
  return recordToRow(MODULE_KEY, task);
}

export async function listTasks(): Promise<TaskRecord[]> {
  return getModuleRows<TaskRecord>(MODULE_KEY);
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
  const task: TaskRecord = {
    Task_ID: generateId("TSK"),
    Title: input.title,
    Description: input.description,
    Assigned_To: input.assignedTo,
    Assigned_By: input.assignedBy,
    Priority: input.priority,
    Task_Type: "One-Time",
    Recurrence_Frequency: "",
    Due_Date: input.dueDate,
    Attachment_URL: input.attachmentUrl,
    Status: "Pending",
    Completed_At: "",
    Completion_Proof_URL: "",
    Remark: input.remark,
    Created_At: nowStamp(),
    On_Time_Count: "0",
    Delay_Count: "0",
    Recurring_ID: "",
  };

  await appendModuleRow(MODULE_KEY, taskToRow(task));
  return task;
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
  const task: TaskRecord = {
    Task_ID: generateId("TSK"),
    Title: input.title,
    Description: "",
    Assigned_To: input.assignedTo,
    Assigned_By: input.assignedBy,
    Priority: "Medium",
    Task_Type: "Recurring",
    Recurrence_Frequency: input.frequency,
    Due_Date: input.dueDate,
    Attachment_URL: "",
    Status: "Pending",
    Completed_At: "",
    Completion_Proof_URL: "",
    Remark: "",
    Created_At: nowStamp(),
    On_Time_Count: "0",
    Delay_Count: "0",
    Recurring_ID: input.recurringId,
  };

  await appendModuleRow(MODULE_KEY, taskToRow(task));
  return task;
}

export async function markTaskDone(
  taskId: string,
  proofUrl: string,
  requestingUserId: string
): Promise<TaskRecord> {
  const found = await findModuleRow<TaskRecord>(MODULE_KEY, 0, taskId);
  if (!found) {
    throw new Error("Task nahi mila.");
  }
  if (found.record.Assigned_To !== requestingUserId) {
    throw new Error("Aap sirf apne assigned tasks complete kar sakte hain.");
  }
  if (found.record.Status !== "Pending") {
    throw new Error("Yeh task pehle se complete ho chuka hai.");
  }

  const now = new Date();
  const dueDate = parseStamp(found.record.Due_Date);
  const isOnTime = !dueDate || now <= dueDate;

  const updated: TaskRecord = {
    ...found.record,
    Status: isOnTime ? "Done on Time" : "Delay Done",
    Completed_At: now.toISOString(),
    Completion_Proof_URL: proofUrl,
    On_Time_Count: String(Number(found.record.On_Time_Count || 0) + (isOnTime ? 1 : 0)),
    Delay_Count: String(Number(found.record.Delay_Count || 0) + (isOnTime ? 0 : 1)),
  };

  await updateModuleRow(MODULE_KEY, found.rowNumber, taskToRow(updated));
  return updated;
}
