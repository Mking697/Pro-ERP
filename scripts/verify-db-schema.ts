/**
 * Throwaway Phase 0 verification script — confirms drizzle-kit push actually created
 * every table in the real Neon database. Run with:
 *   npx tsx scripts/verify-db-schema.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

// Dynamic imports, deliberately after dotenv has loaded .env.local — a static top-level
// `import` is hoisted above config() regardless of source order, so src/db/client.ts
// would read process.env.DATABASE_URL before it was ever set.
async function main() {
  const { db } = await import("../src/db/client");
  const { sql } = await import("drizzle-orm");

  const result = await db.execute(
    sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
  );
  const tableNames = (result.rows as { table_name: string }[]).map((r) => r.table_name);
  console.log(`Found ${tableNames.length} tables in public schema:`);
  for (const name of tableNames) console.log(`  - ${name}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Verification failed:", error);
    process.exit(1);
  });
