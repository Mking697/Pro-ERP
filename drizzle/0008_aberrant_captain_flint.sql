CREATE TABLE "rate_limit_hits" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"identifier" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
