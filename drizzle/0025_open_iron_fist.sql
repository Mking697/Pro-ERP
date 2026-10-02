ALTER TABLE "payslips" ADD COLUMN "pf_employee" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "pf_employer" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "esi_employee" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "esi_employer" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "payslips" ADD COLUMN "tds" numeric DEFAULT '0' NOT NULL;