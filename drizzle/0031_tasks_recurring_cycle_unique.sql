-- OPS-01: durable natural-cycle identity for src/lib/recurringGenerator.ts's daily
-- generation job. Every occurrence it creates for one Recurring_Tasks rule on one
-- calendar day shares a single Due_Date (`${today}T23:59`), so (org_id, recurring_id,
-- due_date) IS that rule's cycle key for the day it was generated — this makes a
-- concurrent/retried cron run idempotent at the database itself, not just by the
-- generator's own read-before-insert check (which two racing calls can both pass before
-- either has actually inserted). Scoped to `recurring_id <> ''` (the sentinel for a
-- one-off, non-recurring Task) so one-off Tasks, which share no such cycle concept at
-- all, are never constrained by this.
--
-- Preflight mirrors migrations 0029/0030's own pattern: aborts the whole migration
-- transaction with a clear message before the CREATE UNIQUE INDEX statement even runs,
-- rather than surfacing Postgres' own generic "could not create unique index" error, if
-- any pre-existing duplicate (org_id, recurring_id, due_date) already violates the new
-- invariant. Expected to be a defensive no-op on any database where the generator's own
-- existing read-before-insert check has, in practice, already prevented this — but
-- unlike 0030's provably-impossible case, this one genuinely could have let a duplicate
-- through under real concurrency before this item's generator-side fix, so it is a real
-- check, not just a formality.
DO $$
DECLARE
  dup record;
BEGIN
  SELECT org_id, recurring_id, due_date, count(*) AS n INTO dup
  FROM tasks
  WHERE recurring_id <> ''
  GROUP BY org_id, recurring_id, due_date
  HAVING count(*) > 1
  LIMIT 1;
  IF dup.n IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 0031 preflight failed: duplicate (org_id, recurring_id, due_date) rows exist in tasks (org_id=%, recurring_id=%, due_date=%, count=%). Reconcile the duplicate recurring occurrences by hand before retrying; never auto-delete history.', dup.org_id, dup.recurring_id, dup.due_date, dup.n;
  END IF;
END
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_org_id_recurring_id_due_date_unique" ON "tasks" USING btree ("org_id","recurring_id","due_date") WHERE "tasks"."recurring_id" <> '';
