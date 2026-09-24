CREATE TYPE "public"."credit_note_usage_kind" AS ENUM('Applied', 'Refunded');--> statement-breakpoint
ALTER TYPE "public"."order_payment_mode" ADD VALUE 'Credit_Note' BEFORE 'Other';--> statement-breakpoint
CREATE TABLE "credit_note_usages" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"credit_note_id" text NOT NULL,
	"kind" "credit_note_usage_kind" NOT NULL,
	"order_id" text DEFAULT '' NOT NULL,
	"amount" numeric NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"invoice_id" text NOT NULL,
	"order_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"credit_note_no" text DEFAULT '' NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"amount" numeric NOT NULL,
	"gst_amount" numeric DEFAULT '0' NOT NULL,
	"attachment_url" text DEFAULT '' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_note_usages" ADD CONSTRAINT "credit_note_usages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_note_usages_org_id_credit_note_id_idx" ON "credit_note_usages" USING btree ("org_id","credit_note_id");--> statement-breakpoint
CREATE INDEX "credit_notes_org_id_customer_id_idx" ON "credit_notes" USING btree ("org_id","customer_id");--> statement-breakpoint
CREATE INDEX "credit_notes_org_id_invoice_id_idx" ON "credit_notes" USING btree ("org_id","invoice_id");