import { date, integer, pgEnum, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * Mirrors MODULE_SHEETS' TASKS, RECURRING_TASKS and HOLIDAY_LIST (src/lib/moduleSheets.ts),
 * i.e. src/lib/tasks.ts, src/lib/recurringTasks.ts and src/lib/holidays.ts.
 */

// TaskRecord.Status — set in src/lib/tasks.ts: "Pending" on create, then flipped once by
// markTaskDone() to either "Done on Time" or "Delay Done". "Not Done" (used in MIS/
// analytics) is never stored — it's a live classification derived from an overdue,
// still-Pending row, same as isIqcOverdue()/isOverdue().
export const taskStatusEnum = pgEnum("task_status", ["Pending", "Done on Time", "Delay Done"]);

export const tasks = pgTable("tasks", {
  // Task_ID, e.g. "TSK-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  assignedTo: text("assigned_to").notNull(),
  assignedBy: text("assigned_by").notNull(),
  // "One-Time" | "Recurring" — open-ended enough (and low-value as an enum) to stay text.
  taskType: text("task_type").notNull(),
  // Frequency code (D/W/15D/M/Q/Y) when Task_Type is "Recurring", else "".
  recurrenceFrequency: text("recurrence_frequency").notNull().default(""),
  // Completion date AND time (see CLAUDE.md Module 3) — a real instant, not a calendar date.
  dueDate: timestamp("due_date", { withTimezone: true }),
  attachmentUrl: text("attachment_url").notNull().default(""),
  status: taskStatusEnum("status").notNull().default("Pending"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completionProofUrl: text("completion_proof_url").notNull().default(""),
  remark: text("remark").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  onTimeCount: integer("on_time_count").notNull().default(0),
  delayCount: integer("delay_count").notNull().default(0),
  // PRIORITIES (src/lib/priority.ts: Low/Medium/High/Urgent) — closed but not a Status
  // column, kept text per the plan's guidance.
  priority: text("priority").notNull().default("Medium"),
  // Blank for a one-off task; set for a generated recurring occurrence — groups back to
  // its Recurring_Tasks definition row.
  recurringId: text("recurring_id").notNull().default(""),
});

// RecurringTaskRecord.Status — src/lib/recurringTasks.ts RECURRING_STATUSES.
export const recurringStatusEnum = pgEnum("recurring_status", ["Active", "Paused"]);

export const recurringTasks = pgTable("recurring_tasks", {
  // Recurring_ID, e.g. "RCR-xxxx".
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  task: text("task").notNull(),
  doerId: text("doer_id").notNull(),
  assignedBy: text("assigned_by").notNull(),
  // Frequency code (D/W/15D/M/Q/Y) — src/lib/frequency.ts FREQUENCY_CODES.
  frequency: text("frequency").notNull(),
  // The anchor date the generator's isScheduledToday() counts every occurrence from —
  // stored as a real timestamp (not `date`) for consistency with every other
  // date/datetime column in this schema; the application layer reads only its calendar
  // date portion today.
  assignDate: timestamp("assign_date", { withTimezone: true }).notNull(),
  status: recurringStatusEnum("status").notNull().default("Active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Mirrors HOLIDAY_LIST — originally just a bare "Date" column (no id at all), read as a
 * Set of "YYYY-MM-DD" strings for holiday-aware scheduling.
 *
 * No surrogate id, per the plan's "no new surrogate keys" rule — but there was never a
 * natural existing *id* here either, only the date itself. The date genuinely is the
 * natural key (a holiday either is or isn't on a given day), so the primary key is the
 * composite (org_id, date) rather than a synthetic id — this is a judgment call specific
 * to this one table, since every other table in this schema keeps its existing generated
 * string id verbatim. A real calendar `date` (no time-of-day) is the correct type here,
 * unlike every other date/datetime column in this schema, which stays `timestamptz`.
 */
export const holidayList = pgTable(
  "holiday_list",
  {
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    date: date("date").notNull(),
    // What the holiday actually is (e.g. "Diwali") — optional, purely for the Admin's own
    // list to be readable; every date-matching/scheduling use of this table only ever
    // reads the date itself.
    name: text("name").notNull().default(""),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.date] })]
);
