CREATE TYPE "public"."lead_activity_kind" AS ENUM('Note', 'Status_Change', 'Follow_Up', 'Meeting', 'Negotiation', 'Quotation', 'Won', 'Lost');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('New', 'Qualified', 'Junk', 'Follow_Up', 'Meeting_Scheduled', 'Negotiation', 'Quotation_Sent', 'Order_Confirmed', 'Lost');--> statement-breakpoint
CREATE TYPE "public"."quotation_status" AS ENUM('Draft', 'Sent', 'Accepted', 'Rejected', 'Expired');--> statement-breakpoint
CREATE TABLE "lead_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"kind" "lead_activity_kind" NOT NULL,
	"message" text NOT NULL,
	"actor_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"person_name" text NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"company_name" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"product_interest" text DEFAULT '' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"status" "lead_status" DEFAULT 'New' NOT NULL,
	"assigned_to" text DEFAULT '' NOT NULL,
	"next_follow_up_at" timestamp with time zone,
	"meeting_at" timestamp with time zone,
	"meeting_mode" text DEFAULT '' NOT NULL,
	"lost_reason" text DEFAULT '' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_items" (
	"quotation_id" text NOT NULL,
	"org_id" text NOT NULL,
	"line_no" text NOT NULL,
	"particular" text DEFAULT '' NOT NULL,
	"specification" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"uom" text DEFAULT '' NOT NULL,
	"qty_formula" text DEFAULT '' NOT NULL,
	"qty" numeric DEFAULT '0' NOT NULL,
	"rate" numeric DEFAULT '0' NOT NULL,
	"amount" numeric DEFAULT '0' NOT NULL,
	CONSTRAINT "quotation_items_quotation_id_line_no_pk" PRIMARY KEY("quotation_id","line_no")
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"quotation_no" text DEFAULT '' NOT NULL,
	"status" "quotation_status" DEFAULT 'Draft' NOT NULL,
	"lead_id" text DEFAULT '' NOT NULL,
	"party_name" text NOT NULL,
	"contact_person" text DEFAULT '' NOT NULL,
	"customer_mobile" text DEFAULT '' NOT NULL,
	"customer_email" text DEFAULT '' NOT NULL,
	"customer_gst" text DEFAULT '' NOT NULL,
	"billing_address" text DEFAULT '' NOT NULL,
	"billing_city" text DEFAULT '' NOT NULL,
	"billing_state" text DEFAULT '' NOT NULL,
	"billing_pincode" text DEFAULT '' NOT NULL,
	"shipping_party_name" text DEFAULT '' NOT NULL,
	"shipping_contact_person" text DEFAULT '' NOT NULL,
	"shipping_address" text DEFAULT '' NOT NULL,
	"shipping_city" text DEFAULT '' NOT NULL,
	"shipping_state" text DEFAULT '' NOT NULL,
	"shipping_pincode" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"terms" text DEFAULT '' NOT NULL,
	"sub_total" numeric DEFAULT '0' NOT NULL,
	"freight_amount" numeric DEFAULT '0' NOT NULL,
	"gst_percent" numeric DEFAULT '18' NOT NULL,
	"gst_amount" numeric DEFAULT '0' NOT NULL,
	"payable_amount" numeric DEFAULT '0' NOT NULL,
	"valid_until" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"attachment_url" text DEFAULT '' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;