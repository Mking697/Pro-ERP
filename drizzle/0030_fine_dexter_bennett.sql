-- DATA-06: items' identity moves from platform-wide (sku alone) to tenant-local
-- (org_id, sku). Preflight mirrors migration 0029's own pattern: it aborts the whole
-- migration transaction (migrations run inside one session.transaction — confirmed by
-- reading drizzle-orm/pg-core/dialect.js, same as 0029's note) before any DDL runs, so a
-- failure leaves the schema/data completely unchanged.
--
-- Mathematically, the OLD constraint (sku alone, platform-wide unique) is a STRICTER
-- condition than the NEW one (org_id, sku) -- any sku already unique platform-wide is
-- automatically unique per-org too, so no existing row can violate the new composite PK.
-- This preflight is therefore a defensive fail-closed check (matching CLAUDE.md's "even
-- an unreviewed migrate run fails closed rather than silently corrupting the invariant"
-- philosophy), not a response to a condition expected to actually occur on this schema.
DO $$
DECLARE
  dup record;
  nullorg record;
BEGIN
  SELECT org_id, sku, count(*) AS n INTO dup
  FROM items
  GROUP BY org_id, sku
  HAVING count(*) > 1
  LIMIT 1;
  IF dup.n IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0030 preflight failed: duplicate (org_id, sku) rows exist in items (org_id=%, sku=%, count=%). Reconcile duplicate item masters/stock ledger/BOM/indent references by hand before retrying; never auto-delete history.', dup.org_id, dup.sku, dup.n;
  END IF;

  SELECT sku INTO nullorg FROM items WHERE org_id IS NULL LIMIT 1;
  IF nullorg.sku IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0030 preflight failed: items row with sku=% has a NULL org_id; the new composite (org_id, sku) primary key cannot include a NULL column. Reconcile before retrying.', nullorg.sku;
  END IF;
END
$$;
--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT "items_pkey";--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_org_id_sku_pk" PRIMARY KEY("org_id","sku");