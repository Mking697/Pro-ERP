CREATE TYPE "public"."dispatch_activity_kind" AS ENUM('Note', 'Gate_Pass_Issued', 'Assigned', 'Dispatched');--> statement-breakpoint
CREATE TYPE "public"."dispatch_status" AS ENUM('In_Transit', 'Dispatched');--> statement-breakpoint
CREATE TABLE "dispatch_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"order_id" text NOT NULL,
	"kind" "dispatch_activity_kind" NOT NULL,
	"message" text NOT NULL,
	"actor_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dispatches" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"order_id" text NOT NULL,
	"shipment_id" text NOT NULL,
	"gate_pass_no" text DEFAULT '' NOT NULL,
	"gate_pass_attachment_url" text DEFAULT '' NOT NULL,
	"assigned_to" text DEFAULT '' NOT NULL,
	"tat_value" numeric,
	"tat_unit" text DEFAULT '' NOT NULL,
	"tat_deadline" timestamp with time zone,
	"status" "dispatch_status" DEFAULT 'In_Transit' NOT NULL,
	"proof_of_dispatch_url" text DEFAULT '' NOT NULL,
	"dispatched_by" text DEFAULT '' NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dispatches_org_id_gate_pass_no_unique" UNIQUE("org_id","gate_pass_no")
);
--> statement-breakpoint
ALTER TABLE "tms_shipments" ADD COLUMN "dispatch_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatch_activities" ADD CONSTRAINT "dispatch_activities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispatches" ADD CONSTRAINT "dispatches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;