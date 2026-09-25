ALTER TABLE "bills" ADD COLUMN "gst_percent" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "gst_amount" numeric DEFAULT '0' NOT NULL;