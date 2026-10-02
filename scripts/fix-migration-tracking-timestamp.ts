/**
 * One-time bookkeeping fix for the live drizzle.__drizzle_migrations table — NOT a schema
 * change, applies no SQL. Diagnosed 2026-10-02 while applying migration 0025 (the new
 * payslips statutory columns): the live tracking table's `created_at` for the rows
 * corresponding to migrations 0023/0024 predate those migrations' CURRENT
 * drizzle/meta/_journal.json `when` timestamps — a side effect of the already-documented
 * "three agents independently generated migration 0022" incident and its reconciliation
 * (see CLAUDE.md's "Working notes", the 0022-collision entry): when the three 0022s were
 * regenerated/renumbered into one committed 0023/0024 sequence, the FILES got fresh `when`
 * stamps, but the live DB's own applied-migrations log still has the OLD timestamps from
 * when that SQL actually first ran. `drizzle-orm/neon-http/migrator.js`'s own `migrate()`
 * only ever compares `lastDbMigration.created_at < migration.folderMillis` — it has no
 * hash-based "already applied" check — so it tried to re-run 0023's `CREATE TYPE ...`
 * statement, which failed with "already exists" (Postgres code 42710), since the real
 * columns/types from 0023/0024 genuinely are already live.
 *
 * Confirmed by hash, not assumed: this script recomputes each migration file's sha256 the
 * exact way readMigrationFiles() does and matches it against the live table's own hash
 * column before touching anything — it will REFUSE if the hash it expects at the latest
 * row doesn't match, rather than blindly bumping a timestamp.
 *
 * Fix: bump the LATEST existing row's created_at to the higher of 0023's/0024's current
 * journal `when` values (still comfortably below 0025's `when`) — this is bookkeeping
 * only, exactly the same "mark as applied without re-running" move CLAUDE.md documents
 * for the 0000 baseline migration, not a new precedent.
 *
 * Run: npx tsx scripts/fix-migration-tracking-timestamp.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import crypto from "node:crypto";
import fs from "node:fs";

async function main() {
  const { db } = await import("../src/db/client");
  const { sql } = await import("drizzle-orm");

  const journal = JSON.parse(fs.readFileSync("./drizzle/meta/_journal.json", "utf-8")) as {
    entries: { tag: string; when: number }[];
  };
  const entry0023 = journal.entries.find((e) => e.tag === "0023_nasty_black_crow");
  const entry0024 = journal.entries.find((e) => e.tag === "0024_nostalgic_spencer_smythe");
  if (!entry0023 || !entry0024) {
    console.error("Could not find 0023/0024 in the journal — has this already been fixed, or " +
      "has the journal changed? Refusing to guess.");
    process.exitCode = 1;
    return;
  }

  const hashOf = (tag: string) =>
    crypto.createHash("sha256").update(fs.readFileSync(`./drizzle/${tag}.sql`, "utf-8")).digest("hex");
  const hash0023 = hashOf("0023_nasty_black_crow");
  const hash0024 = hashOf("0024_nostalgic_spencer_smythe");

  const rows = (
    await db.execute<{ id: number; hash: string; created_at: string }>(
      sql`SELECT id, hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id`
    )
  ).rows;

  const row0023 = rows.find((r) => r.hash === hash0023);
  const row0024 = rows.find((r) => r.hash === hash0024);
  console.log(`Row matching 0023's current file hash: ${row0023 ? `id=${row0023.id}, created_at=${row0023.created_at}` : "NOT FOUND"}`);
  console.log(`Row matching 0024's current file hash: ${row0024 ? `id=${row0024.id}, created_at=${row0024.created_at}` : "NOT FOUND"}`);

  if (!row0023 || !row0024) {
    console.error(
      "\n❌ Refusing — could not find a live DB row whose hash matches the CURRENT 0023 or " +
        "0024 migration file. This means the live DB's schema may not actually match what " +
        "those files describe — do not blindly bump a timestamp here. Needs manual " +
        "investigation (compare live schema against both .sql files by hand) before any fix."
    );
    process.exitCode = 1;
    return;
  }

  const targetCreatedAt = Math.max(entry0023.when, entry0024.when);
  const latestRow = rows[rows.length - 1];
  console.log(`\nLatest row by id: id=${latestRow.id}, created_at=${latestRow.created_at}`);
  console.log(`Target created_at (max of 0023/0024 journal 'when'): ${targetCreatedAt}`);

  if (Number(latestRow.created_at) >= targetCreatedAt) {
    console.log("\n✅ Already in sync — no fix needed.");
    return;
  }

  await db.execute(
    sql`UPDATE drizzle.__drizzle_migrations SET created_at = ${targetCreatedAt} WHERE id = ${latestRow.id}`
  );
  console.log(`\n✅ Updated row id=${latestRow.id}'s created_at to ${targetCreatedAt} (no SQL re-run, bookkeeping only).`);
}

main().catch((e) => {
  console.error("fix-migration-tracking-timestamp failed:", e);
  process.exit(1);
});
