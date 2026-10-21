CREATE TABLE "customer_portal_links" (
	"token" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"created_by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_portal_links_org_id_customer_id_unique" UNIQUE("org_id","customer_id")
);
--> statement-breakpoint
ALTER TABLE "customer_portal_links" ADD CONSTRAINT "customer_portal_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;