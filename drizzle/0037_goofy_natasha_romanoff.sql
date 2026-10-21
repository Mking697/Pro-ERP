CREATE TABLE "razorpay_plan_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"razorpay_plan_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "razorpay_subscription_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "subscription_status" text DEFAULT '' NOT NULL;