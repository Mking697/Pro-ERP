/**
 * Migration-sync pre-flight check — run automatically before `npx drizzle-kit generate`
 * (wired as `npm run db:generate` below) to catch exactly the collision CLAUDE.md
 * documents under "Working notes": several background agents, each branched from the
 * same starting schema snapshot, independently generating a migration numbered the same
 * (`0022` three times, in one real incident) — each one's own `prevId` chain is only
 * valid against the snapshot state *that agent* saw, which silently goes stale the moment
 * ANY other migration is generated-and-applied by someone else in the meantime.
 *
 * `drizzle-kit generate` itself has no live-DB-awareness at all — it only ever diffs the
 * local schema against the local `drizzle/meta/*_snapshot.json` chain, so it has no way to
 * notice that the live database has already moved past what your own local `_journal.json`
 * thinks is the latest applied migration. This script is that missing check: it reads the
 * live `drizzle.__drizzle_migrations` table directly (the exact table/hash scheme
 * `drizzle-orm/neon-http/migrator.js`'s own `migrate()` uses — see CLAUDE.md's "Migration
 * tooling" section) and compares its row count against the local journal's entry count.
 *
 * This is a LOCK in the sense that matters here — it can't literally prevent two humans
 * from running `generate` at the same instant (Postgres has no "reserve the next migration
 * number" primitive drizzle-kit exposes), but it turns the real failure mode (silent
 * schema drift discovered days later) into a loud, immediate refusal: "your local journal
 * is behind the live DB — pull/merge main and regenerate your snapshot before generating a
 * new migration," which is exactly the manual reconciliation CLAUDE.md's working notes
 * already describe doing by hand after the fact. This catches the problem before it ships
 * instead of after.
 *
 * Run: npx tsx scripts/check-migration-sync.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

async function main() {
  const { db } = await import("../src/db/client");
  const { sql } = await import("drizzle-orm");

  const journalPath = resolve(__dirname, "../drizzle/meta/_journal.json");
  if (!existsSync(journalPath)) {
    console.log("No drizzle/meta/_journal.json found yet — nothing to check (first migration).");
    return;
  }
  const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as {
    entries: { idx: number; tag: string }[];
  };
  const localCount = journal.entries.length;
  const localLatestTag = journal.entries.at(-1)?.tag ?? "(none)";

  // Mirrors drizzle-orm/neon-http/migrator.js's own migrationsTable/migrationsSchema
  // defaults exactly — this is the same table `drizzle-kit migrate` itself reads/writes.
  let appliedCount: number;
  try {
    const result = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM drizzle.__drizzle_migrations`
    );
    appliedCount = Number(result.rows[0]?.count ?? 0);
  } catch (err) {
    // A brand-new DB with no migrations table yet is not a drift error — it just means
    // nothing has ever been applied, which is consistent with any local journal state
    // that also hasn't been applied yet. Only a real query failure (bad DATABASE_URL,
    // network) should still be surfaced, not swallowed as "assume 0".
    const message = err instanceof Error ? err.message : String(err);
    if (/relation .* does not exist/i.test(message)) {
      appliedCount = 0;
    } else {
      throw err;
    }
  }

  console.log(`Local journal entries : ${localCount} (latest: ${localLatestTag})`);
  console.log(`Applied in live DB    : ${appliedCount}`);

  if (appliedCount > localCount) {
    console.error(
      `\n❌ REFUSING — the live database has ${appliedCount} migrations applied, but your local ` +
        `drizzle/meta/_journal.json only knows about ${localCount}. Generating a new migration ` +
        `right now would compute its diff against a STALE snapshot — exactly the collision that ` +
        `produced three different agents' migrations all numbered "0022" in this project's own ` +
        `history (see CLAUDE.md's "Working notes" section on migration-ID collisions).\n\n` +
        `Fix: pull the latest drizzle/ directory from main (or run \`npx drizzle-kit pull\` against ` +
        `this live DB) so your local snapshot chain reflects what's actually applied, THEN run ` +
        `\`npx drizzle-kit generate\` again.\n`
    );
    process.exitCode = 1;
    return;
  }

  if (appliedCount < localCount) {
    console.warn(
      `\n⚠️  Your local journal has ${localCount - appliedCount} migration(s) not yet applied to ` +
        `this database (normal if you just generated one and haven't run \`drizzle-kit migrate\` ` +
        `yet — not a drift error, just a heads-up).\n`
    );
    return;
  }

  console.log("\n✅ In sync — safe to generate a new migration.");
}

main().catch((err) => {
  console.error("check-migration-sync failed:", err);
  process.exit(1);
});
