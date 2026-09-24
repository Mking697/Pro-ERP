DROP INDEX "bills_org_id_po_id_idx";--> statement-breakpoint
DROP INDEX "invoices_org_id_order_id_idx";--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gst_percent" numeric DEFAULT '18' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "gst_amount" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "gst_amount" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_org_id_po_id_unique" UNIQUE("org_id","po_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_order_id_unique" UNIQUE("org_id","order_id");