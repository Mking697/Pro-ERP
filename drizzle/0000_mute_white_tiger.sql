CREATE TYPE "public"."org_status" AS ENUM('Active', 'Suspended');--> statement-breakpoint
CREATE TYPE "public"."users_index_status" AS ENUM('Active', 'Inactive');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('Active', 'Inactive');--> statement-breakpoint
CREATE TYPE "public"."recurring_status" AS ENUM('Active', 'Paused');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('Pending', 'Done on Time', 'Delay Done');--> statement-breakpoint
CREATE TYPE "public"."iqc_status" AS ENUM('Pending', 'Verified');--> statement-breakpoint
CREATE TYPE "public"."bom_status" AS ENUM('Active', 'Archived');--> statement-breakpoint
CREATE TYPE "public"."indent_status" AS ENUM('Pending', 'Approved', 'Ordered', 'Partially_Received', 'Received', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."item_status" AS ENUM('Active', 'Inactive');--> statement-breakpoint
CREATE TYPE "public"."plan_material_status" AS ENUM('Allocated', 'Shortage', 'Consumed');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('Ready', 'Shortage', 'In_Production', 'Completed', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."fms_action_type" AS ENUM('', 'LEDGER_MOVEMENT');--> statement-breakpoint
CREATE TYPE "public"."fms_data_source_type" AS ENUM('', 'FORM', 'EXISTING_FMS', 'FORM_AND_EXISTING');--> statement-breakpoint
CREATE TYPE "public"."fms_outcome_type" AS ENUM('', 'DONE', 'PASS_FAIL', 'PASS_FAIL_QTY', 'NUMBER', 'TEXT', 'ATTACHMENT');--> statement-breakpoint
CREATE TYPE "public"."fms_run_status" AS ENUM('Pending', 'On Time', 'Delay Done');--> statement-breakpoint
CREATE TYPE "public"."fms_template_status" AS ENUM('Active', 'Archived');--> statement-breakpoint
CREATE TYPE "public"."fms_weekoff_scope" AS ENUM('ALL', 'DEPARTMENT', 'USER');--> statement-breakpoint
CREATE TYPE "public"."leave_approval_decision" AS ENUM('Pending', 'Approved', 'Rejected');--> statement-breakpoint
CREATE TYPE "public"."leave_approver_type" AS ENUM('REPORTING_MANAGER', 'SPECIFIC_USER');--> statement-breakpoint
CREATE TYPE "public"."leave_status" AS ENUM('Pending', 'Approved', 'Rejected', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."customer_status" AS ENUM('Active', 'Inactive');--> statement-breakpoint
CREATE TYPE "public"."vendor_status" AS ENUM('Active', 'Inactive');--> statement-breakpoint
CREATE TYPE "public"."purchase_order_status" AS ENUM('Open', 'Completed', 'Cancelled');--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_name" text NOT NULL,
	"slug" text NOT NULL,
	"owner_email" text NOT NULL,
	"plan" text DEFAULT 'Free' NOT NULL,
	"status" "org_status" DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "report_shares" (
	"token" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"report" text NOT NULL,
	"label" text NOT NULL,
	"range_key" text NOT NULL,
	"from_date" text DEFAULT '' NOT NULL,
	"to_date" text DEFAULT '' NOT NULL,
	"access" text[] DEFAULT '{}' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users_index" (
	"email" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" "users_index_status" DEFAULT 'Active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text NOT NULL,
	"department" text DEFAULT '' NOT NULL,
	"phone_number" text DEFAULT '' NOT NULL,
	"status" "user_status" DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"module_access" text[] DEFAULT '{}' NOT NULL,
	"shift" text DEFAULT '1' NOT NULL,
	"reporting_manager_id" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"org_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text DEFAULT '' NOT NULL,
	CONSTRAINT "settings_org_id_key_unique" UNIQUE("org_id","key")
);
--> statement-breakpoint
CREATE TABLE "holiday_list" (
	"org_id" text NOT NULL,
	"date" date NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	CONSTRAINT "holiday_list_org_id_date_pk" PRIMARY KEY("org_id","date")
);
--> statement-breakpoint
CREATE TABLE "recurring_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"task" text NOT NULL,
	"doer_id" text NOT NULL,
	"assigned_by" text NOT NULL,
	"frequency" text NOT NULL,
	"assign_date" timestamp with time zone NOT NULL,
	"status" "recurring_status" DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"assigned_to" text NOT NULL,
	"assigned_by" text NOT NULL,
	"task_type" text NOT NULL,
	"recurrence_frequency" text DEFAULT '' NOT NULL,
	"due_date" timestamp with time zone,
	"attachment_url" text DEFAULT '' NOT NULL,
	"status" "task_status" DEFAULT 'Pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"completion_proof_url" text DEFAULT '' NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"on_time_count" integer DEFAULT 0 NOT NULL,
	"delay_count" integer DEFAULT 0 NOT NULL,
	"priority" text DEFAULT 'Medium' NOT NULL,
	"recurring_id" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "failure_log" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"linked_entry_id" text NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"party_name" text NOT NULL,
	"invoice_no" text DEFAULT '' NOT NULL,
	"inward_type" text DEFAULT '' NOT NULL,
	"fail_qty" numeric NOT NULL,
	"fail_reason" text DEFAULT '' NOT NULL,
	"attachment_url" text DEFAULT '' NOT NULL,
	"verified_by" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ims_inward" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"linked_entry_id" text NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"party_name" text NOT NULL,
	"invoice_no" text DEFAULT '' NOT NULL,
	"inward_type" text DEFAULT '' NOT NULL,
	"pass_qty" numeric NOT NULL,
	"verified_by" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inward_iqc_fms" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"party_name" text NOT NULL,
	"vendor_id" text DEFAULT '' NOT NULL,
	"invoice_no" text DEFAULT '' NOT NULL,
	"inward_type" text DEFAULT '' NOT NULL,
	"attachment_url" text DEFAULT '' NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"iqc_status" "iqc_status" DEFAULT 'Pending' NOT NULL,
	"verified_by" text DEFAULT '' NOT NULL,
	"verified_at" timestamp with time zone,
	"verify_checkbox" text DEFAULT '' NOT NULL,
	"iqc_pass_qty" numeric,
	"iqc_fail_qty" numeric,
	"fail_reason" text DEFAULT '' NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"item_name" text DEFAULT '' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"iqc_tat_value" numeric,
	"iqc_tat_unit" text DEFAULT '' NOT NULL,
	"iqc_deadline" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bom" (
	"bom_id" text NOT NULL,
	"org_id" text NOT NULL,
	"product_name" text NOT NULL,
	"product_sku" text NOT NULL,
	"version" text DEFAULT '' NOT NULL,
	"line_no" text NOT NULL,
	"component_sku" text NOT NULL,
	"component_name" text DEFAULT '' NOT NULL,
	"component_type" text DEFAULT 'Item' NOT NULL,
	"qty_per_unit" numeric,
	"uom" text DEFAULT '' NOT NULL,
	"status" "bom_status" DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	CONSTRAINT "bom_bom_id_line_no_pk" PRIMARY KEY("bom_id","line_no")
);
--> statement-breakpoint
CREATE TABLE "indents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"sku" text NOT NULL,
	"item_name" text DEFAULT '' NOT NULL,
	"suggested_qty" numeric,
	"final_qty" numeric,
	"uom" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"linked_plan_id" text DEFAULT '' NOT NULL,
	"status" "indent_status" DEFAULT 'Pending' NOT NULL,
	"requested_by" text DEFAULT '' NOT NULL,
	"approved_by" text DEFAULT '' NOT NULL,
	"approved_at" timestamp with time zone,
	"expected_date" timestamp with time zone,
	"received_qty" numeric,
	"received_at" timestamp with time zone,
	"po_id" text DEFAULT '' NOT NULL,
	"step1_due_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "items" (
	"sku" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"item_name" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"size_unit" text DEFAULT '' NOT NULL,
	"uom" text DEFAULT '' NOT NULL,
	"rate" numeric,
	"adc_manual" numeric,
	"lead_time_days" integer,
	"safety_factor" numeric,
	"moq" numeric,
	"max_level" numeric,
	"location" text DEFAULT '' NOT NULL,
	"status" "item_status" DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"sku" text NOT NULL,
	"direction" text NOT NULL,
	"quantity" numeric NOT NULL,
	"uom" text DEFAULT '' NOT NULL,
	"source" text NOT NULL,
	"reference_id" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"issued_to" text DEFAULT '' NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"user_id" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_materials" (
	"plan_id" text NOT NULL,
	"org_id" text NOT NULL,
	"sku" text NOT NULL,
	"item_name" text DEFAULT '' NOT NULL,
	"qty_per_unit" numeric,
	"required_qty" numeric,
	"uom" text DEFAULT '' NOT NULL,
	"allocated_qty" numeric,
	"shortage_qty" numeric,
	"consumed_qty" numeric,
	"status" "plan_material_status" DEFAULT 'Shortage' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_materials_plan_id_sku_pk" PRIMARY KEY("plan_id","sku")
);
--> statement-breakpoint
CREATE TABLE "production_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"product_name" text NOT NULL,
	"product_sku" text NOT NULL,
	"bom_id" text DEFAULT '' NOT NULL,
	"bom_version" text DEFAULT '' NOT NULL,
	"planned_qty" numeric NOT NULL,
	"production_date" timestamp with time zone,
	"status" "plan_status" DEFAULT 'Ready' NOT NULL,
	"actual_qty" numeric,
	"started_by" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone,
	"created_by" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"job_no" text DEFAULT '' NOT NULL,
	"order_no" text DEFAULT '' NOT NULL,
	"fms_template_id" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fms_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"instance_id" text NOT NULL,
	"template_id" text NOT NULL,
	"template_name" text DEFAULT '' NOT NULL,
	"context_ref" text DEFAULT '' NOT NULL,
	"started_by" text DEFAULT '' NOT NULL,
	"started_at" timestamp with time zone,
	"step_no" integer NOT NULL,
	"step_name" text NOT NULL,
	"assigned_to" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tat_start" timestamp with time zone,
	"tat_deadline" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_by" text DEFAULT '' NOT NULL,
	"outcome" text DEFAULT '' NOT NULL,
	"status" "fms_run_status" DEFAULT 'Pending' NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"form_data" jsonb,
	"quantity" numeric
);
--> statement-breakpoint
CREATE TABLE "fms_templates" (
	"template_id" text NOT NULL,
	"org_id" text NOT NULL,
	"template_name" text NOT NULL,
	"trigger_event" text NOT NULL,
	"status" "fms_template_status" DEFAULT 'Active' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"step_no" integer NOT NULL,
	"step_name" text NOT NULL,
	"assigned_to" text DEFAULT '' NOT NULL,
	"tat_value" numeric,
	"tat_unit" text DEFAULT '' NOT NULL,
	"outcome_options" text DEFAULT '' NOT NULL,
	"next_step_map" jsonb,
	"data_source_type" "fms_data_source_type" DEFAULT '' NOT NULL,
	"data_source_config" jsonb,
	"action_type" "fms_action_type" DEFAULT '' NOT NULL,
	"action_config" jsonb,
	"outcome_type" "fms_outcome_type" DEFAULT '' NOT NULL,
	"tat_source_step_no" integer,
	"tat_source_field_key" text DEFAULT '' NOT NULL,
	"tat_offset" numeric,
	"notify_on_complete" text[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "fms_templates_template_id_step_no_pk" PRIMARY KEY("template_id","step_no")
);
--> statement-breakpoint
CREATE TABLE "fms_weekoff_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"date" date NOT NULL,
	"scope" "fms_weekoff_scope" NOT NULL,
	"scope_value" text DEFAULT '' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_approval_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"step_no" integer NOT NULL,
	"approver_type" "leave_approver_type" NOT NULL,
	"specific_user_id" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"leave_id" text NOT NULL,
	"step_no" integer NOT NULL,
	"approver_id" text NOT NULL,
	"decision" "leave_approval_decision" DEFAULT 'Pending' NOT NULL,
	"remark" text DEFAULT '' NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "leave_reassignments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"leave_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"original_assignee" text NOT NULL,
	"buddy_id" text NOT NULL,
	"reassigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reverted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "leaves" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"doer_id" text NOT NULL,
	"leave_type" text DEFAULT '' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"buddy_id" text DEFAULT '' NOT NULL,
	"is_emergency" boolean DEFAULT false NOT NULL,
	"filed_by" text DEFAULT '' NOT NULL,
	"status" "leave_status" DEFAULT 'Pending' NOT NULL,
	"current_step_no" integer DEFAULT 1 NOT NULL,
	"activated_at" timestamp with time zone,
	"reverted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"customer_name" text NOT NULL,
	"contact_person" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"gstin" text DEFAULT '' NOT NULL,
	"billing_address" text DEFAULT '' NOT NULL,
	"shipping_address" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"credit_terms" text DEFAULT '' NOT NULL,
	"status" "customer_status" DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_items" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"sku" text NOT NULL,
	"lead_time_days" integer,
	"unit_price" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	CONSTRAINT "vendor_items_vendor_sku_unique" UNIQUE("vendor_id","sku")
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"vendor_name" text NOT NULL,
	"contact_person" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"gstin" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"payment_terms" text DEFAULT '' NOT NULL,
	"bank_name" text DEFAULT '' NOT NULL,
	"bank_account_no" text DEFAULT '' NOT NULL,
	"ifsc" text DEFAULT '' NOT NULL,
	"status" "vendor_status" DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"po_id" text NOT NULL,
	"indent_id" text NOT NULL,
	"sku" text NOT NULL,
	"old_price" numeric,
	"new_price" numeric,
	CONSTRAINT "purchase_order_lines_po_indent_unique" UNIQUE("po_id","indent_id")
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"status" "purchase_order_status" DEFAULT 'Open' NOT NULL,
	"attachment_url" text DEFAULT '' NOT NULL,
	"invoice_url" text DEFAULT '' NOT NULL,
	"issued_by" text DEFAULT '' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"follow_up_due_at" timestamp with time zone,
	"follow_up_done_by" text DEFAULT '' NOT NULL,
	"follow_up_done_at" timestamp with time zone,
	"follow_up_remark" text DEFAULT '' NOT NULL,
	"material_received_due_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "report_shares" ADD CONSTRAINT "report_shares_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users_index" ADD CONSTRAINT "users_index_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_list" ADD CONSTRAINT "holiday_list_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_tasks" ADD CONSTRAINT "recurring_tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "failure_log" ADD CONSTRAINT "failure_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ims_inward" ADD CONSTRAINT "ims_inward_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inward_iqc_fms" ADD CONSTRAINT "inward_iqc_fms_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom" ADD CONSTRAINT "bom_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "indents" ADD CONSTRAINT "indents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_ledger" ADD CONSTRAINT "stock_ledger_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_materials" ADD CONSTRAINT "plan_materials_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_plans" ADD CONSTRAINT "production_plans_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fms_runs" ADD CONSTRAINT "fms_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fms_templates" ADD CONSTRAINT "fms_templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fms_weekoff_overrides" ADD CONSTRAINT "fms_weekoff_overrides_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_approval_steps" ADD CONSTRAINT "leave_approval_steps_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_approvals" ADD CONSTRAINT "leave_approvals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_reassignments" ADD CONSTRAINT "leave_reassignments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_items" ADD CONSTRAINT "vendor_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;