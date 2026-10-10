DO $$
DECLARE
  dup record;
BEGIN
  SELECT org_id, shipment_id, count(*) AS n INTO dup
  FROM dispatches
  WHERE shipment_id <> ''
  GROUP BY org_id, shipment_id
  HAVING count(*) > 1
  LIMIT 1;
  IF dup.n IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0029 preflight failed: duplicate nonempty dispatches(org_id, shipment_id) rows exist (org_id=%, shipment_id=%, count=%). Reconcile duplicate stock/consumption/links before retrying; never auto-delete history.', dup.org_id, dup.shipment_id, dup.n;
  END IF;
END
$$;
--> statement-breakpoint
CREATE TABLE "mutation_receipts" (
	"org_id" text NOT NULL,
	"key" text NOT NULL,
	"actor_id" text NOT NULL,
	"operation" text NOT NULL,
	"payload_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mutation_receipts_org_id_key_pk" PRIMARY KEY("org_id","key")
);
--> statement-breakpoint
ALTER TABLE "mutation_receipts" ADD CONSTRAINT "mutation_receipts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dispatches_org_id_shipment_id_unique" ON "dispatches" USING btree ("org_id","shipment_id") WHERE "dispatches"."shipment_id" <> '';