CREATE TYPE "public"."order_activity_kind" AS ENUM('Note', 'Status_Change', 'Items_Mapped', 'Payment', 'Credit_Hold', 'Credit_Approved', 'Stock_Reserved', 'Shortage_Notified', 'Dispatch_Committed', 'Cancelled');--> statement-breakpoint
CREATE TYPE "public"."order_payment_mode" AS ENUM('Cash', 'UPI', 'Bank_Transfer', 'Cheque', 'Card', 'Other');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('Items_Pending', 'Payment_Review', 'Credit_Hold', 'Stock_Check', 'Dispatch_Pending', 'Ready_For_PDI', 'Cancelled');--> statement-breakpoint
CREATE TABLE "order_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"order_id" text NOT NULL,
	"kind" "order_activity_kind" NOT NULL,
	"message" text NOT NULL,
	"actor_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"order_id" text NOT NULL,
	"org_id" text NOT NULL,
	"line_no" text NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"item_name" text DEFAULT '' NOT NULL,
	"uom" text DEFAULT '' NOT NULL,
	"qty" numeric DEFAULT '0' NOT NULL,
	"rate" numeric DEFAULT '0' NOT NULL,
	"amount" numeric DEFAULT '0' NOT NULL,
	"reserved_qty" numeric DEFAULT '0' NOT NULL,
	"shortage_qty" numeric DEFAULT '0' NOT NULL,
	CONSTRAINT "order_items_order_id_line_no_pk" PRIMARY KEY("order_id","line_no")
);
--> statement-breakpoint
CREATE TABLE "order_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"order_id" text NOT NULL,
	"amount" numeric NOT NULL,
	"mode" "order_payment_mode" DEFAULT 'Bank_Transfer' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"source" text DEFAULT 'Direct' NOT NULL,
	"lead_id" text DEFAULT '' NOT NULL,
	"quotation_id" text DEFAULT '' NOT NULL,
	"customer_id" text DEFAULT '' NOT NULL,
	"party_name" text DEFAULT '' NOT NULL,
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
	"po_attachment_url" text DEFAULT '' NOT NULL,
	"status" "order_status" DEFAULT 'Items_Pending' NOT NULL,
	"order_value" numeric DEFAULT '0' NOT NULL,
	"credit_approved_by" text DEFAULT '' NOT NULL,
	"credit_approved_at" timestamp with time zone,
	"dispatch_commit_date" timestamp with time zone,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "credit_limit" numeric;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "credit_days" integer;--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "order_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_activities" ADD CONSTRAINT "order_activities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_payments" ADD CONSTRAINT "order_payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;