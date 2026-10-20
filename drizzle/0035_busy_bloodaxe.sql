CREATE TYPE "public"."billing_payment_status" AS ENUM('Created', 'Paid', 'Failed');--> statement-breakpoint
CREATE TABLE "billing_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"plan" text NOT NULL,
	"billing_cycle" text NOT NULL,
	"amount" numeric NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"razorpay_order_id" text NOT NULL,
	"razorpay_payment_id" text DEFAULT '' NOT NULL,
	"status" "billing_payment_status" DEFAULT 'Created' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "billing_payments_razorpay_order_id_unique" UNIQUE("razorpay_order_id")
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "billing_cycle" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "plan_renews_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "razorpay_customer_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "billing_payments_org_id_idx" ON "billing_payments" USING btree ("org_id");