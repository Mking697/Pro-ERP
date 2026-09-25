ALTER TABLE "failure_log" ADD COLUMN "deviation_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "failure_log" ADD COLUMN "deviation_requested_by" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "failure_log" ADD COLUMN "deviation_approved_by" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "failure_log" ADD COLUMN "deviation_approved_at" timestamp with time zone;