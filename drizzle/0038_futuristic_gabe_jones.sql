CREATE TABLE "billing_subscription_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"plan" text NOT NULL,
	"cycle" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"currency" text NOT NULL,
	"key_id" text NOT NULL,
	"provider_plan_id" text,
	"provider_id" text,
	"status" text DEFAULT 'reserved' NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_subscription_attempts_provider_id_unique" UNIQUE("provider_id"),
	CONSTRAINT "billing_subscription_positive_amount" CHECK ("billing_subscription_attempts"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE TABLE "billing_subscription_charges" (
	"payment_id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"paid_through" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_subscription_attempts" ADD CONSTRAINT "billing_subscription_attempts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscription_charges" ADD CONSTRAINT "billing_subscription_charges_attempt_id_billing_subscription_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."billing_subscription_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_subscription_one_open_org" ON "billing_subscription_attempts" USING btree ("org_id") WHERE "billing_subscription_attempts"."closed_at" is null;--> statement-breakpoint
CREATE INDEX "billing_subscription_attempt_org_idx" ON "billing_subscription_attempts" USING btree ("org_id");