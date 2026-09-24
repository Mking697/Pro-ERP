CREATE TYPE "public"."debit_note_usage_kind" AS ENUM('Applied', 'Received');--> statement-breakpoint
ALTER TYPE "public"."order_payment_mode" ADD VALUE 'Debit_Note' BEFORE 'Other';--> statement-breakpoint
CREATE TABLE "debit_note_usages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"debit_note_id" text NOT NULL,
	"kind" "debit_note_usage_kind" NOT NULL,
	"bill_id" text DEFAULT '' NOT NULL,
	"amount" numeric NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "debit_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"debit_note_no" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"linked_failure_log_id" text DEFAULT '' NOT NULL,
	"amount" numeric NOT NULL,
	"attachment_url" text DEFAULT '' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "failure_log" ADD COLUMN "moved_to_inventory_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "failure_log" ADD COLUMN "debit_note_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "debit_note_usages" ADD CONSTRAINT "debit_note_usages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debit_notes" ADD CONSTRAINT "debit_notes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "debit_note_usages_org_id_debit_note_id_idx" ON "debit_note_usages" USING btree ("org_id","debit_note_id");--> statement-breakpoint
CREATE INDEX "debit_notes_org_id_vendor_id_idx" ON "debit_notes" USING btree ("org_id","vendor_id");