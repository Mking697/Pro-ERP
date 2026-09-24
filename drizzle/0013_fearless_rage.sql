CREATE TYPE "public"."petty_cash_kind" AS ENUM('TopUp', 'Expense');--> statement-breakpoint
CREATE TABLE "expense_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"entry_date" timestamp with time zone DEFAULT now() NOT NULL,
	"category_account_id" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"paid_to" text DEFAULT '' NOT NULL,
	"amount" numeric NOT NULL,
	"attachment_url" text DEFAULT '' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "petty_cash_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"entry_date" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" "petty_cash_kind" NOT NULL,
	"counter_account_id" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"amount" numeric NOT NULL,
	"attachment_url" text DEFAULT '' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_entries" ADD CONSTRAINT "expense_entries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "petty_cash_entries" ADD CONSTRAINT "petty_cash_entries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_entries_org_id_idx" ON "expense_entries" USING btree ("org_id","entry_date");--> statement-breakpoint
CREATE INDEX "petty_cash_entries_org_id_idx" ON "petty_cash_entries" USING btree ("org_id","entry_date");