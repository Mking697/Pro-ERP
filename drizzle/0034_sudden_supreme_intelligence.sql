CREATE TYPE "public"."general_purchase_order_status" AS ENUM('Open', 'Completed', 'Cancelled');--> statement-breakpoint
CREATE TABLE "general_purchase_order_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"po_id" text NOT NULL,
	"particular" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"uom" text DEFAULT '' NOT NULL,
	"qty" numeric DEFAULT '0' NOT NULL,
	"rate" numeric DEFAULT '0' NOT NULL,
	"amount" numeric DEFAULT '0' NOT NULL,
	"received_qty" numeric
);
--> statement-breakpoint
CREATE TABLE "general_purchase_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"plan_id" text DEFAULT '' NOT NULL,
	"status" "general_purchase_order_status" DEFAULT 'Open' NOT NULL,
	"attachment_url" text DEFAULT '' NOT NULL,
	"invoice_url" text DEFAULT '' NOT NULL,
	"issued_by" text DEFAULT '' NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expected_delivery_days" numeric DEFAULT '0' NOT NULL,
	"follow_up_due_at" timestamp with time zone,
	"follow_up_done_by" text DEFAULT '' NOT NULL,
	"follow_up_done_at" timestamp with time zone,
	"follow_up_remark" text DEFAULT '' NOT NULL,
	"received_at" timestamp with time zone,
	"received_by" text DEFAULT '' NOT NULL,
	"gst_percent" numeric DEFAULT '0' NOT NULL,
	"terms_and_conditions" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "customer_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "general_purchase_order_lines" ADD CONSTRAINT "general_purchase_order_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "general_purchase_orders" ADD CONSTRAINT "general_purchase_orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "general_purchase_order_lines_org_id_po_id_idx" ON "general_purchase_order_lines" USING btree ("org_id","po_id");--> statement-breakpoint
CREATE INDEX "general_purchase_orders_org_id_idx" ON "general_purchase_orders" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "general_purchase_orders_org_id_plan_id_idx" ON "general_purchase_orders" USING btree ("org_id","plan_id");