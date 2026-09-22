CREATE TYPE "public"."account_type" AS ENUM('Asset', 'Liability', 'Equity', 'Income', 'Expense');--> statement-breakpoint
CREATE TYPE "public"."bill_status" AS ENUM('Draft', 'Issued');--> statement-breakpoint
CREATE TYPE "public"."payroll_run_status" AS ENUM('Draft', 'Finalized');--> statement-breakpoint
ALTER TYPE "public"."dispatch_activity_kind" ADD VALUE 'Delivered';--> statement-breakpoint
ALTER TYPE "public"."dispatch_status" ADD VALUE 'Delivered';--> statement-breakpoint
CREATE TABLE "leave_quotas" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"leave_type" text NOT NULL,
	"annual_days" numeric DEFAULT '0' NOT NULL,
	CONSTRAINT "leave_quotas_org_id_leave_type_unique" UNIQUE("org_id","leave_type")
);
--> statement-breakpoint
CREATE TABLE "bill_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"bill_id" text NOT NULL,
	"amount" numeric NOT NULL,
	"mode" "order_payment_mode" DEFAULT 'Bank_Transfer' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bills" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"po_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"bill_no" text DEFAULT '' NOT NULL,
	"bill_attachment_url" text DEFAULT '' NOT NULL,
	"amount" numeric DEFAULT '0' NOT NULL,
	"status" "bill_status" DEFAULT 'Draft' NOT NULL,
	"issued_by" text DEFAULT '' NOT NULL,
	"issued_at" timestamp with time zone,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chart_of_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chart_of_accounts_org_id_code_unique" UNIQUE("org_id","code")
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"entry_date" timestamp with time zone DEFAULT now() NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"source_type" text DEFAULT '' NOT NULL,
	"source_id" text DEFAULT '' NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"entry_id" text NOT NULL,
	"org_id" text NOT NULL,
	"line_no" integer NOT NULL,
	"account_id" text NOT NULL,
	"debit" numeric DEFAULT '0' NOT NULL,
	"credit" numeric DEFAULT '0' NOT NULL,
	CONSTRAINT "journal_lines_entry_id_line_no_pk" PRIMARY KEY("entry_id","line_no")
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"month" text NOT NULL,
	"status" "payroll_run_status" DEFAULT 'Draft' NOT NULL,
	"generated_by" text DEFAULT '' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_by" text DEFAULT '' NOT NULL,
	"finalized_at" timestamp with time zone,
	CONSTRAINT "payroll_runs_org_id_month_unique" UNIQUE("org_id","month")
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"payroll_run_id" text NOT NULL,
	"user_id" text NOT NULL,
	"monthly_salary" numeric DEFAULT '0' NOT NULL,
	"days_in_month" integer NOT NULL,
	"days_employed" integer NOT NULL,
	"gross_pay" numeric DEFAULT '0' NOT NULL,
	"net_pay" numeric DEFAULT '0' NOT NULL,
	"pdf_url" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payslips_payroll_run_id_user_id_unique" UNIQUE("payroll_run_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "salary_structures" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"monthly_salary" numeric DEFAULT '0' NOT NULL,
	"effective_from" date NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dispatches" ADD COLUMN "pod_attachment_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatches" ADD COLUMN "delivered_by" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "dispatches" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "leave_quotas" ADD CONSTRAINT "leave_quotas_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;