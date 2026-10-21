CREATE TABLE "currencies" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"currency_code" text NOT NULL,
	"rate_to_inr" numeric NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_enabled_currencies" (
	"org_id" text NOT NULL,
	"currency_code" text NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "org_enabled_currencies_org_id_currency_code_pk" PRIMARY KEY("org_id","currency_code")
);
--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "display_currency" text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "display_exchange_rate" numeric;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "display_amount" numeric;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "display_currency" text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "display_exchange_rate" numeric;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "display_amount" numeric;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "display_currency" text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "display_exchange_rate" numeric;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "display_amount" numeric;--> statement-breakpoint
ALTER TABLE "exchange_rates" ADD CONSTRAINT "exchange_rates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_enabled_currencies" ADD CONSTRAINT "org_enabled_currencies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exchange_rates_org_id_currency_code_effective_from_idx" ON "exchange_rates" USING btree ("org_id","currency_code","effective_from");--> statement-breakpoint
CREATE INDEX "org_enabled_currencies_org_id_idx" ON "org_enabled_currencies" USING btree ("org_id");