CREATE TABLE "tenant_usage_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"metric_date" date NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"storage_row_count" integer DEFAULT 0 NOT NULL,
	"storage_bytes_estimate" numeric DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_usage_metrics" ADD CONSTRAINT "tenant_usage_metrics_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_usage_metrics_org_id_idx" ON "tenant_usage_metrics" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "tenant_usage_metrics_metric_date_idx" ON "tenant_usage_metrics" USING btree ("metric_date");