CREATE TYPE "public"."transport_arranged_by" AS ENUM('Self', 'Party');--> statement-breakpoint
CREATE TYPE "public"."tms_activity_kind" AS ENUM('Note', 'Shipment_Planned', 'Follow_Up', 'Loading_Dock_Confirmed');--> statement-breakpoint
CREATE TYPE "public"."tms_shipment_status" AS ENUM('Pending', 'At_Loading_Dock');--> statement-breakpoint
CREATE TYPE "public"."transport_vendor_status" AS ENUM('Active', 'Inactive');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('Draft', 'Issued');--> statement-breakpoint
CREATE TABLE "tms_activities" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"order_id" text NOT NULL,
	"kind" "tms_activity_kind" NOT NULL,
	"message" text NOT NULL,
	"actor_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tms_shipment_items" (
	"shipment_id" text NOT NULL,
	"org_id" text NOT NULL,
	"line_no" text NOT NULL,
	"sku" text NOT NULL,
	"item_name" text DEFAULT '' NOT NULL,
	"uom" text DEFAULT '' NOT NULL,
	"qty" numeric DEFAULT '0' NOT NULL,
	CONSTRAINT "tms_shipment_items_shipment_id_line_no_pk" PRIMARY KEY("shipment_id","line_no")
);
--> statement-breakpoint
CREATE TABLE "tms_shipments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"order_id" text NOT NULL,
	"transport_vendor_id" text DEFAULT '' NOT NULL,
	"vehicle_size" text DEFAULT '' NOT NULL,
	"vehicle_price" numeric DEFAULT '0' NOT NULL,
	"from_warehouse" text DEFAULT '' NOT NULL,
	"to_address" text DEFAULT '' NOT NULL,
	"vehicle_no" text DEFAULT '' NOT NULL,
	"driver_contact_no" text DEFAULT '' NOT NULL,
	"status" "tms_shipment_status" DEFAULT 'Pending' NOT NULL,
	"loading_dock_confirmed_by" text DEFAULT '' NOT NULL,
	"loading_dock_confirmed_at" timestamp with time zone,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transport_vendors" (
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
	"status" "transport_vendor_status" DEFAULT 'Active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"order_id" text NOT NULL,
	"invoice_no" text DEFAULT '' NOT NULL,
	"invoice_attachment_url" text DEFAULT '' NOT NULL,
	"eway_bill_no" text DEFAULT '' NOT NULL,
	"eway_bill_attachment_url" text DEFAULT '' NOT NULL,
	"extra_document_url" text DEFAULT '' NOT NULL,
	"final_value" numeric DEFAULT '0' NOT NULL,
	"status" "invoice_status" DEFAULT 'Draft' NOT NULL,
	"issued_by" text DEFAULT '' NOT NULL,
	"issued_at" timestamp with time zone,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "transport_arranged_by" "transport_arranged_by";--> statement-breakpoint
ALTER TABLE "tms_activities" ADD CONSTRAINT "tms_activities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_shipment_items" ADD CONSTRAINT "tms_shipment_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tms_shipments" ADD CONSTRAINT "tms_shipments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transport_vendors" ADD CONSTRAINT "transport_vendors_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;