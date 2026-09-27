ALTER TABLE "organizations" ALTER COLUMN "plan" SET DEFAULT 'Trial';--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
-- Data backfill (hand-added, reviewed before applying — see CLAUDE.md's "Migration
-- tooling" note on this convention): every existing real org was on the old flat
-- Free(5 users)/Pro(unlimited) split (src/lib/platform/planLimits.ts before 2026-09-27).
-- Those tier names no longer exist in the new Trial/Growth/Scale/Enterprise scheme, and
-- `normalizePlanTier()` would otherwise treat a leftover "Free"/"Pro" value as unrecognized
-- and silently normalize it to "Growth" for limits purposes while the raw column still read
-- "Free"/"Pro" everywhere it's displayed (e.g. /platform's own plan dropdown). Backfilling
-- the column itself, once, keeps the stored value and its effective behavior in sync, and
-- lands every pre-existing org on a real unlimited-relative-to-trial paid tier rather than
-- ever reading as a fresh, time-limited Trial (new orgs get "Trial" only via
-- createOrganization()'s own INSERT, never via this UPDATE, since it targets "Free"/"Pro"
-- specifically).
UPDATE "organizations" SET "plan" = 'Growth' WHERE "plan" = 'Free';--> statement-breakpoint
UPDATE "organizations" SET "plan" = 'Scale' WHERE "plan" = 'Pro';