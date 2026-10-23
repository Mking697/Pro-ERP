CREATE TABLE "cost_sheets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"product_sku" text NOT NULL,
	"product_name" text NOT NULL,
	"revision" integer NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"calculation" jsonb NOT NULL,
	"supersedes_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	"finalized_by" text,
	CONSTRAINT "cost_sheets_state_check" CHECK ("cost_sheets"."revision" > 0 AND "cost_sheets"."version" > 0 AND (("cost_sheets"."status" = 'Draft' AND "cost_sheets"."finalized_at" IS NULL AND "cost_sheets"."finalized_by" IS NULL) OR ("cost_sheets"."status" = 'Finalized' AND "cost_sheets"."finalized_at" IS NOT NULL AND "cost_sheets"."finalized_by" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "standard_cost_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"sku" text NOT NULL,
	"uom" text NOT NULL,
	"rate" numeric(15, 6) NOT NULL,
	"effective_date" date NOT NULL,
	"reason" text NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "standard_cost_rates_nonnegative_check" CHECK ("standard_cost_rates"."rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "job_cost_lineages" (
	"org_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"active_finalized_sheet_id" text,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "job_cost_lineages_version_check" CHECK ("job_cost_lineages"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "job_cost_sheets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"product_sku" text NOT NULL,
	"revision" integer NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"calculation" jsonb NOT NULL,
	"supersedes_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"finalized_at" timestamp with time zone,
	"finalized_by" text,
	CONSTRAINT "job_cost_sheets_state_check" CHECK ("job_cost_sheets"."revision" > 0 AND "job_cost_sheets"."version" > 0 AND (("job_cost_sheets"."status" = 'Draft' AND "job_cost_sheets"."finalized_at" IS NULL AND "job_cost_sheets"."finalized_by" IS NULL) OR ("job_cost_sheets"."status" = 'Finalized' AND "job_cost_sheets"."finalized_at" IS NOT NULL AND "job_cost_sheets"."finalized_by" IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "job_cost_source_allocations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"sheet_id" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"po_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"head" text NOT NULL,
	"allocated_amount" numeric(15, 2) NOT NULL,
	"eligible_cap" numeric(15, 2) NOT NULL,
	"source_fingerprint" text NOT NULL,
	"facts" jsonb NOT NULL,
	"basis" text NOT NULL,
	"reason" text NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "job_cost_source_allocations_nonnegative_check" CHECK ("job_cost_source_allocations"."allocated_amount" >= 0 AND "job_cost_source_allocations"."eligible_cap" >= 0 AND "job_cost_source_allocations"."allocated_amount" <= "job_cost_source_allocations"."eligible_cap")
);
--> statement-breakpoint
ALTER TABLE "cost_sheets" ADD CONSTRAINT "cost_sheets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standard_cost_rates" ADD CONSTRAINT "standard_cost_rates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cost_lineages" ADD CONSTRAINT "job_cost_lineages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cost_sheets" ADD CONSTRAINT "job_cost_sheets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_cost_source_allocations" ADD CONSTRAINT "job_cost_source_allocations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cost_sheets_org_product_revision_uidx" ON "cost_sheets" USING btree ("org_id","product_sku","revision");--> statement-breakpoint
CREATE INDEX "cost_sheets_org_status_idx" ON "cost_sheets" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "standard_cost_rates_org_sku_date_idx" ON "standard_cost_rates" USING btree ("org_id","sku","effective_date");--> statement-breakpoint
CREATE UNIQUE INDEX "job_cost_lineages_org_plan_uidx" ON "job_cost_lineages" USING btree ("org_id","plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_cost_sheets_org_plan_revision_uidx" ON "job_cost_sheets" USING btree ("org_id","plan_id","revision");--> statement-breakpoint
CREATE INDEX "job_cost_sheets_org_plan_status_idx" ON "job_cost_sheets" USING btree ("org_id","plan_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "job_cost_source_allocations_org_sheet_source_uidx" ON "job_cost_source_allocations" USING btree ("org_id","sheet_id","source_kind","source_id");--> statement-breakpoint
CREATE INDEX "job_cost_source_allocations_org_source_active_idx" ON "job_cost_source_allocations" USING btree ("org_id","source_kind","source_id","active");