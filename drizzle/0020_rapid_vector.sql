ALTER TABLE "purchase_orders" ADD COLUMN "gst_percent" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "terms_and_conditions" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "note" text DEFAULT '' NOT NULL;