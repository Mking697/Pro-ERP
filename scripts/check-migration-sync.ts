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

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";

/**
 * QA-03 fix: count equality is not identity or schema parity. Two journals can have
 * the same number of entries while a migration file was edited after being applied,
 * or while local/remote lineages diverged in order — a pure count comparison passes
 * that silently. This mirrors the EXACT ordered hash+timestamp comparison
 * tests/local-isolated/migrate.cjs already proved correct against a real database
 * (`assert.deepEqual(rows.map(r => ({hash,when})), migrations.map(m => ({hash,folderMillis})))`),
 * generalized only to tolerate a local-ahead prefix (not-yet-applied local migrations,
 * a legitimate day-to-day state, not drift).
 */
export type LocalMigration = { hash: string; folderMillis: number };
export type AppliedMigration = { hash: string; when: number };
export type SyncDiagnosis =
  | { status: "ahead"; appliedCount: number; localCount: number }
  | { status: "behind"; appliedCount: number; localCount: number }
  | { status: "drift"; index: number; applied: AppliedMigration; local: LocalMigration }
  | { status: "in-sync"; count: number };

export function diagnoseMigrationLineage(
  local: LocalMigration[],
  applied: AppliedMigration[]
): SyncDiagnosis {
  if (applied.length > local.length) {
    return { status: "ahead", appliedCount: applied.length, localCount: local.length };
  }
  for (let i = 0; i < applied.length; i++) {
    const a = applied[i];
    const l = local[i];
    if (a.hash !== l.hash || a.when !== l.folderMillis) {
      return { status: "drift", index: i, applied: a, local: l };
    }
  }
  if (applied.length < local.length) {
    return { status: "behind", appliedCount: applied.length, localCount: local.length };
  }
  return { status: "in-sync", count: applied.length };
}

async function main() {
  config({ path: ".env.local" });
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

  const drizzleDir = resolve(__dirname, "../drizzle");
  const local: LocalMigration[] = readMigrationFiles({ migrationsFolder: drizzleDir }).map((m) => ({
    hash: m.hash,
    folderMillis: m.folderMillis,
  }));

  // Mirrors drizzle-orm/neon-http/migrator.js's own migrationsTable/migrationsSchema
  // defaults exactly — this is the same table `drizzle-kit migrate` itself reads/writes.
  // Ordered by created_at (not id) so the comparison reflects actual applied lineage,
  // the same ordering tests/local-isolated/migrate.cjs's live-DB assertion uses.
  let applied: AppliedMigration[];
  try {
    const result = await db.execute<{ hash: string; created_at: string }>(
      sql`SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`
    );
    applied = result.rows.map((r) => ({ hash: r.hash, when: Number(r.created_at) }));
  } catch (err) {
    // A brand-new DB with no migrations table yet is not a drift error — it just means
    // nothing has ever been applied, which is consistent with any local journal state
    // that also hasn't been applied yet. Only a real query failure (bad DATABASE_URL,
    // network) should still be surfaced, not swallowed as "assume none applied".
    const message = err instanceof Error ? err.message : String(err);
    if (/relation .* does not exist/i.test(message)) {
      applied = [];
    } else {
      throw err;
    }
  }

  console.log(`Local journal entries : ${localCount} (latest: ${localLatestTag})`);
  console.log(`Applied in live DB    : ${applied.length}`);

  const diagnosis = diagnoseMigrationLineage(local, applied);

  if (diagnosis.status === "ahead") {
    console.error(
      `\n❌ REFUSING — the live database has ${diagnosis.appliedCount} migrations applied, but your local ` +
        `drizzle/meta/_journal.json only knows about ${diagnosis.localCount}. Generating a new migration ` +
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

  if (diagnosis.status === "drift") {
    const tag = journal.entries[diagnosis.index]?.tag ?? `index ${diagnosis.index}`;
    console.error(
      `\n❌ REFUSING — the live database's migration lineage does not match the local journal at ` +
        `entry ${diagnosis.index} (${tag}), even though the migration COUNT is equal. Applied: ` +
        `hash=${diagnosis.applied.hash} when=${diagnosis.applied.when}; local: ` +
        `hash=${diagnosis.local.hash} when=${diagnosis.local.folderMillis}. Equal counts are NOT ` +
        `proof of sync — this means a checked-in migration file was edited after being applied, or ` +
        `the local/remote journals reordered. Generating a new migration right now would diff against ` +
        `a lineage that doesn't match what's actually live.\n\n` +
        `Fix: reconcile the live DB and local drizzle/ directory (e.g. \`npx drizzle-kit pull\`) so the ` +
        `lineages match hash-for-hash before generating or migrating again.\n`
    );
    process.exitCode = 1;
    return;
  }

  if (diagnosis.status === "behind") {
    console.warn(
      `\n⚠️  Your local journal has ${diagnosis.localCount - diagnosis.appliedCount} migration(s) not yet ` +
        `applied to this database (normal if you just generated one and haven't run \`drizzle-kit migrate\` ` +
        `yet — not a drift error, just a heads-up).\n`
    );
    return;
  }

  console.log("\n✅ In sync — safe to generate a new migration.");
}

const isMain = process.argv[1] ? fileURLToPath(import.meta.url) === resolve(process.argv[1]) : false;
if (isMain) {
  main().catch((err) => {
    console.error("check-migration-sync failed:", err);
    process.exit(1);
  });
}
