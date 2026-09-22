CREATE TYPE "public"."pdi_activity_kind" AS ENUM('Note', 'Waiting_Stock', 'Stock_Available', 'Inspected_Pass', 'Inspected_Fail');--> statement-breakpoint
CREATE TYPE "public"."pdi_status" AS ENUM('Pending', 'Passed');--> statement-breakpoint
CREATE TABLE "pdi_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"pdi_id" text NOT NULL,
	"kind" "pdi_activity_kind" NOT NULL,
	"message" text NOT NULL,
	"attachment_url" text DEFAULT '' NOT NULL,
	"actor_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pdi_inspections" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"order_id" text NOT NULL,
	"status" "pdi_status" DEFAULT 'Pending' NOT NULL,
	"due_at" timestamp with time zone,
	"attachment_url" text DEFAULT '' NOT NULL,
	"passed_by" text DEFAULT '' NOT NULL,
	"passed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pdi_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pdi_activities" ADD CONSTRAINT "pdi_activities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pdi_inspections" ADD CONSTRAINT "pdi_inspections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;