CREATE TABLE "error_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text DEFAULT '' NOT NULL,
	"route_path" text DEFAULT '' NOT NULL,
	"route_type" text DEFAULT '' NOT NULL,
	"message" text NOT NULL,
	"digest" text DEFAULT '' NOT NULL,
	"stack" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
