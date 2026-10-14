import { index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * Field Service — Service Jobs (installation/service work punched manually against a
 * Customer Master row), Complaints (customer-reported issue, raised internally by
 * staff), and Site Visits (an internally-raised inspection/survey visit) — three
 * separate hardcoded flows (not a generic FMS Template, same precedent as Purchase/
 * Leads/Orders — these need their own board + a bespoke multi-Doer/step UI the generic
 * engine has no slot for), sharing one Doer-completion mechanism.
 *
 * `customerId`/`doerId` are plain text, not FK-enforced, matching every other
 * cross-entity reference in this schema (vendor_items.vendorId, indents.sku, ...) —
 * deliberately so deleteOrganization()'s batch delete has no cross-table ordering to
 * get right, and so a Doer whose user account is later deleted doesn't orphan the
 * assignment row (doerName is a permanent snapshot, see field_task_assignments below).
 *
 * The shared completion mechanism, mirrored from a reference service-ops app the user
 * handed over to learn from (their own separate project, not merged in):
 * - `field_task_assignments` — one row per Doer assigned to a task IN A GIVEN CYCLE. A
 *   task can have several Doers at once, and can be reopened for another round after
 *   Completed (`currentCycle` bumps, a fresh set of assignment rows is created for the
 *   new cycle, the previous cycle's rows are kept as permanent history).
 * - `field_task_steps` — one row per task PER CYCLE, the Doer's own 3-step field
 *   completion flow: Step 1 (site photo + optional video, with lat/long captured from
 *   the device — moves the task to In_Progress), Step 2 (work-complete evidence for a
 *   Service/Complaint, or visit notes + an optional site chart upload for a Site
 *   Visit), Step 3 (expense amount/notes + optional uploaded bills — moves the task to
 *   Completed for that cycle). See src/lib/fieldService/steps.ts.
 * - `field_service_activities` — append-only timeline, same convention as
 *   order_activities/lead_activities/pdi_activities/maintenance_activities.
 */

export const fieldTaskTypeEnum = pgEnum("field_task_type", ["SERVICE", "COMPLAINT", "SITE_VISIT"]);

// Shared by all three task tables below. "Assigned" exists separately from "Pending" so
// a task with a Doer on it but no field work started yet reads distinctly from a fresh,
// unassigned one — mirrors Order FMS's own Items_Pending-is-never-persisted philosophy
// in spirit (a real, meaningful state, not a UI label derived from other columns).
export const fieldTaskStatusEnum = pgEnum("field_task_status", [
  "Pending",
  "Assigned",
  "In_Progress",
  "Completed",
]);

export const serviceJobs = pgTable(
  "service_jobs",
  {
    // Service_ID, e.g. "SVJ-xxxx".
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    customerId: text("customer_id").notNull(),
    productDetails: text("product_details").notNull().default(""),
    brand: text("brand").notNull().default(""),
    siteAddress: text("site_address").notNull().default(""),
    attendantName: text("attendant_name").notNull().default(""),
    attendantPhone: text("attendant_phone").notNull().default(""),
    status: fieldTaskStatusEnum("status").notNull().default("Pending"),
    // Bumped each time a Completed job is reopened/reassigned — see this file's own
    // header comment on field_task_assignments/field_task_steps.
    currentCycle: integer("current_cycle").notNull().default(1),
    createdBy: text("created_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("service_jobs_org_id_idx").on(table.orgId),
    index("service_jobs_org_id_status_idx").on(table.orgId, table.status),
    index("service_jobs_org_id_customer_id_idx").on(table.orgId, table.customerId),
  ]
);

export const complaintWarrantyEnum = pgEnum("complaint_warranty_status", [
  "In_Warranty",
  "Out_Of_Warranty",
]);

export const complaints = pgTable(
  "complaints",
  {
    // Complaint_ID, e.g. "CMP-xxxx".
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    // Shown to the customer as e.g. "CMP-0001" — allocated by the app (read current
    // highest + 1, retry on a real unique-constraint collision), same pattern as
    // quotations.quotationNo / dispatch.gatePassNo. Not a DB serial — see those two
    // files' own allocator comments for why.
    complaintNo: integer("complaint_no").notNull(),
    customerId: text("customer_id").notNull(),
    // Free-text reference to the Order/Service job this complaint is about, if any —
    // deliberately not FK-enforced against either table (a complaint can reference a
    // job that predates this module, or no job at all).
    jobReference: text("job_reference").notNull().default(""),
    warrantyStatus: complaintWarrantyEnum("warranty_status").notNull().default("Out_Of_Warranty"),
    issueDescription: text("issue_description").notNull().default(""),
    siteAddress: text("site_address").notNull().default(""),
    attendantName: text("attendant_name").notNull().default(""),
    attendantPhone: text("attendant_phone").notNull().default(""),
    // The customer's own invoice/bill, if attached at punch time.
    attachmentUrl: text("attachment_url").notNull().default(""),
    // Problem photos/videos — array of uploaded URLs.
    mediaUrls: jsonb("media_urls"),
    status: fieldTaskStatusEnum("status").notNull().default("Pending"),
    currentCycle: integer("current_cycle").notNull().default(1),
    createdBy: text("created_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("complaints_org_id_complaint_no_unique").on(table.orgId, table.complaintNo),
    index("complaints_org_id_idx").on(table.orgId),
    index("complaints_org_id_status_idx").on(table.orgId, table.status),
    index("complaints_org_id_customer_id_idx").on(table.orgId, table.customerId),
  ]
);

export const siteVisitForEnum = pgEnum("site_visit_for", [
  "Installation_Check",
  "Quality_Complaint",
  "Sales_Demo",
  "Other",
]);

export const siteVisits = pgTable(
  "site_visits",
  {
    // SiteVisit_ID, e.g. "SVT-xxxx".
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    // Shown as e.g. "SV-0001" (zero-padded) — same app-level allocator convention as
    // complaints.complaintNo above.
    serialNo: integer("serial_no").notNull(),
    customerId: text("customer_id").notNull(),
    // How the request came in — Phone Call, WhatsApp, Email, In Person, Other.
    raisedVia: text("raised_via").notNull().default(""),
    raisedByName: text("raised_by_name").notNull().default(""),
    siteAddress: text("site_address").notNull().default(""),
    // Picked on the map when raising the visit (src/components/location-picker.tsx).
    siteLatitude: numeric("site_latitude"),
    siteLongitude: numeric("site_longitude"),
    attendantName: text("attendant_name").notNull().default(""),
    attendantPhone: text("attendant_phone").notNull().default(""),
    visitFor: siteVisitForEnum("visit_for").notNull().default("Other"),
    status: fieldTaskStatusEnum("status").notNull().default("Pending"),
    currentCycle: integer("current_cycle").notNull().default(1),
    createdBy: text("created_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("site_visits_org_id_serial_no_unique").on(table.orgId, table.serialNo),
    index("site_visits_org_id_idx").on(table.orgId),
    index("site_visits_org_id_status_idx").on(table.orgId, table.status),
    index("site_visits_org_id_customer_id_idx").on(table.orgId, table.customerId),
  ]
);

// ---------------------------------------------------------------------------
// Shared across all three task types, keyed by (taskType, taskId[, cycle]).
// ---------------------------------------------------------------------------

export const fieldTaskAssignments = pgTable(
  "field_task_assignments",
  {
    // Assignment_ID, e.g. "FTA-xxxx".
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    taskType: fieldTaskTypeEnum("task_type").notNull(),
    taskId: text("task_id").notNull(),
    // Nullable in spirit (blank string once the Doer's user account is deleted) —
    // doerName is the permanent snapshot, so history never breaks when an ex-employee's
    // account is removed. Kept plain text (not FK) for the same deleteOrganization()
    // ordering reason as every other cross-entity reference in this schema.
    doerId: text("doer_id").notNull().default(""),
    doerName: text("doer_name").notNull().default(""),
    cycle: integer("cycle").notNull().default(1),
    fundAmount: numeric("fund_amount"),
    fundNotes: text("fund_notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("field_task_assignments_unique").on(
      table.orgId,
      table.taskType,
      table.taskId,
      table.doerId,
      table.cycle
    ),
    index("field_task_assignments_org_id_task_idx").on(table.orgId, table.taskType, table.taskId),
    index("field_task_assignments_org_id_doer_id_idx").on(table.orgId, table.doerId),
  ]
);

export const fieldTaskSteps = pgTable(
  "field_task_steps",
  {
    // Step_ID, e.g. "FTS-xxxx".
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    taskType: fieldTaskTypeEnum("task_type").notNull(),
    taskId: text("task_id").notNull(),
    cycle: integer("cycle").notNull().default(1),

    sitePhotoUrl: text("site_photo_url").notNull().default(""),
    siteVideoUrl: text("site_video_url").notNull().default(""),
    latitude: numeric("latitude"),
    longitude: numeric("longitude"),
    step1At: timestamp("step1_at", { withTimezone: true }),

    evidenceUrl: text("evidence_url").notNull().default(""),
    notes: text("notes").notNull().default(""),
    chartUrl: text("chart_url").notNull().default(""),
    step2At: timestamp("step2_at", { withTimezone: true }),

    expenseAmount: numeric("expense_amount"),
    expenseNotes: text("expense_notes").notNull().default(""),
    billUrls: jsonb("bill_urls"),
    step3At: timestamp("step3_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("field_task_steps_unique").on(table.orgId, table.taskType, table.taskId, table.cycle),
    index("field_task_steps_org_id_task_idx").on(table.orgId, table.taskType, table.taskId),
  ]
);

export const fieldServiceActivityKindEnum = pgEnum("field_service_activity_kind", [
  "Note",
  "Created",
  "Assigned",
  "Unassigned",
  "Step1_Done",
  "Step2_Done",
  "Step3_Done",
  "Completed",
  "Reopened",
]);

export const fieldServiceActivities = pgTable(
  "field_service_activities",
  {
    // Activity_ID, e.g. "FSA-xxxx".
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    taskType: fieldTaskTypeEnum("task_type").notNull(),
    taskId: text("task_id").notNull(),
    kind: fieldServiceActivityKindEnum("kind").notNull(),
    message: text("message").notNull(),
    actorId: text("actor_id").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("field_service_activities_org_id_task_idx").on(table.orgId, table.taskType, table.taskId)]
);
