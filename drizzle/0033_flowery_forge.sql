CREATE TYPE "public"."complaint_warranty_status" AS ENUM('In_Warranty', 'Out_Of_Warranty');--> statement-breakpoint
CREATE TYPE "public"."field_service_activity_kind" AS ENUM('Note', 'Created', 'Assigned', 'Unassigned', 'Step1_Done', 'Step2_Done', 'Step3_Done', 'Completed', 'Reopened');--> statement-breakpoint
CREATE TYPE "public"."field_task_status" AS ENUM('Pending', 'Assigned', 'In_Progress', 'Completed');--> statement-breakpoint
CREATE TYPE "public"."field_task_type" AS ENUM('SERVICE', 'COMPLAINT', 'SITE_VISIT');--> statement-breakpoint
CREATE TYPE "public"."site_visit_for" AS ENUM('Installation_Check', 'Quality_Complaint', 'Sales_Demo', 'Other');--> statement-breakpoint
CREATE TABLE "complaints" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"complaint_no" integer NOT NULL,
	"customer_id" text NOT NULL,
	"job_reference" text DEFAULT '' NOT NULL,
	"warranty_status" "complaint_warranty_status" DEFAULT 'Out_Of_Warranty' NOT NULL,
	"issue_description" text DEFAULT '' NOT NULL,
	"site_address" text DEFAULT '' NOT NULL,
	"attendant_name" text DEFAULT '' NOT NULL,
	"attendant_phone" text DEFAULT '' NOT NULL,
	"attachment_url" text DEFAULT '' NOT NULL,
	"media_urls" jsonb,
	"status" "field_task_status" DEFAULT 'Pending' NOT NULL,
	"current_cycle" integer DEFAULT 1 NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "complaints_org_id_complaint_no_unique" UNIQUE("org_id","complaint_no")
);
--> statement-breakpoint
CREATE TABLE "field_service_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"task_type" "field_task_type" NOT NULL,
	"task_id" text NOT NULL,
	"kind" "field_service_activity_kind" NOT NULL,
	"message" text NOT NULL,
	"actor_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_task_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"task_type" "field_task_type" NOT NULL,
	"task_id" text NOT NULL,
	"doer_id" text DEFAULT '' NOT NULL,
	"doer_name" text DEFAULT '' NOT NULL,
	"cycle" integer DEFAULT 1 NOT NULL,
	"fund_amount" numeric,
	"fund_notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_task_assignments_unique" UNIQUE("org_id","task_type","task_id","doer_id","cycle")
);
--> statement-breakpoint
CREATE TABLE "field_task_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"task_type" "field_task_type" NOT NULL,
	"task_id" text NOT NULL,
	"cycle" integer DEFAULT 1 NOT NULL,
	"site_photo_url" text DEFAULT '' NOT NULL,
	"site_video_url" text DEFAULT '' NOT NULL,
	"latitude" numeric,
	"longitude" numeric,
	"step1_at" timestamp with time zone,
	"evidence_url" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"chart_url" text DEFAULT '' NOT NULL,
	"step2_at" timestamp with time zone,
	"expense_amount" numeric,
	"expense_notes" text DEFAULT '' NOT NULL,
	"bill_urls" jsonb,
	"step3_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_task_steps_unique" UNIQUE("org_id","task_type","task_id","cycle")
);
--> statement-breakpoint
CREATE TABLE "service_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"product_details" text DEFAULT '' NOT NULL,
	"brand" text DEFAULT '' NOT NULL,
	"site_address" text DEFAULT '' NOT NULL,
	"attendant_name" text DEFAULT '' NOT NULL,
	"attendant_phone" text DEFAULT '' NOT NULL,
	"status" "field_task_status" DEFAULT 'Pending' NOT NULL,
	"current_cycle" integer DEFAULT 1 NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_visits" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"serial_no" integer NOT NULL,
	"customer_id" text NOT NULL,
	"raised_via" text DEFAULT '' NOT NULL,
	"raised_by_name" text DEFAULT '' NOT NULL,
	"site_address" text DEFAULT '' NOT NULL,
	"site_latitude" numeric,
	"site_longitude" numeric,
	"attendant_name" text DEFAULT '' NOT NULL,
	"attendant_phone" text DEFAULT '' NOT NULL,
	"visit_for" "site_visit_for" DEFAULT 'Other' NOT NULL,
	"status" "field_task_status" DEFAULT 'Pending' NOT NULL,
	"current_cycle" integer DEFAULT 1 NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_visits_org_id_serial_no_unique" UNIQUE("org_id","serial_no")
);
--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_service_activities" ADD CONSTRAINT "field_service_activities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_task_assignments" ADD CONSTRAINT "field_task_assignments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_task_steps" ADD CONSTRAINT "field_task_steps_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_jobs" ADD CONSTRAINT "service_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_visits" ADD CONSTRAINT "site_visits_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "complaints_org_id_idx" ON "complaints" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "complaints_org_id_status_idx" ON "complaints" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "complaints_org_id_customer_id_idx" ON "complaints" USING btree ("org_id","customer_id");--> statement-breakpoint
CREATE INDEX "field_service_activities_org_id_task_idx" ON "field_service_activities" USING btree ("org_id","task_type","task_id");--> statement-breakpoint
CREATE INDEX "field_task_assignments_org_id_task_idx" ON "field_task_assignments" USING btree ("org_id","task_type","task_id");--> statement-breakpoint
CREATE INDEX "field_task_assignments_org_id_doer_id_idx" ON "field_task_assignments" USING btree ("org_id","doer_id");--> statement-breakpoint
CREATE INDEX "field_task_steps_org_id_task_idx" ON "field_task_steps" USING btree ("org_id","task_type","task_id");--> statement-breakpoint
CREATE INDEX "service_jobs_org_id_idx" ON "service_jobs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "service_jobs_org_id_status_idx" ON "service_jobs" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "service_jobs_org_id_customer_id_idx" ON "service_jobs" USING btree ("org_id","customer_id");--> statement-breakpoint
CREATE INDEX "site_visits_org_id_idx" ON "site_visits" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "site_visits_org_id_status_idx" ON "site_visits" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "site_visits_org_id_customer_id_idx" ON "site_visits" USING btree ("org_id","customer_id");