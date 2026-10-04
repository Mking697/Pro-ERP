CREATE TYPE "public"."maintenance_activity_kind" AS ENUM('Note', 'Reported', 'Assigned', 'Fixed_By_Maintenance', 'Resolved', 'Reopened', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."maintenance_kind" AS ENUM('Breakdown', 'Generator_Repair', 'Servicing', 'Wiring', 'Light_Change', 'Other');--> statement-breakpoint
CREATE TYPE "public"."maintenance_status" AS ENUM('Open', 'Fixed_By_Maintenance', 'Resolved', 'Cancelled');--> statement-breakpoint
ALTER TYPE "public"."fms_run_status" ADD VALUE 'Paused' BEFORE 'On Time';--> statement-breakpoint
CREATE TABLE "maintenance_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"request_id" text NOT NULL,
	"kind" "maintenance_activity_kind" NOT NULL,
	"message" text NOT NULL,
	"actor_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" "maintenance_kind" NOT NULL,
	"production_line_run_id" text DEFAULT '' NOT NULL,
	"production_line_template_name" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "maintenance_status" DEFAULT 'Open' NOT NULL,
	"reported_by" text DEFAULT '' NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_to" text DEFAULT '' NOT NULL,
	"fixed_by" text DEFAULT '' NOT NULL,
	"fixed_at" timestamp with time zone,
	"fixed_remark" text DEFAULT '' NOT NULL,
	"confirmed_by" text DEFAULT '' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_remark" text DEFAULT '' NOT NULL,
	"paused_tat_deadline" timestamp with time zone,
	"working_minutes_lost" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "maintenance_activities" ADD CONSTRAINT "maintenance_activities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_activities_org_id_request_id_idx" ON "maintenance_activities" USING btree ("org_id","request_id");--> statement-breakpoint
CREATE INDEX "maintenance_requests_org_id_idx" ON "maintenance_requests" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "maintenance_requests_org_id_status_idx" ON "maintenance_requests" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "maintenance_requests_org_id_run_id_idx" ON "maintenance_requests" USING btree ("org_id","production_line_run_id");