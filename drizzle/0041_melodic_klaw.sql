CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text DEFAULT '' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"source_event_id" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_org_id_user_id_is_read_idx" ON "notifications" USING btree ("org_id","user_id","is_read");--> statement-breakpoint
CREATE INDEX "notifications_org_id_user_id_created_at_idx" ON "notifications" USING btree ("org_id","user_id","created_at");