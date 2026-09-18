import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/db/schema";

/**
 * Singleton Neon HTTP client + Drizzle instance.
 *
 * Deliberately `drizzle-orm/neon-http`, NOT the WebSocket/pooled driver — this app only
 * ever needs single-round-trip queries, never long-lived interactive transactions held
 * open across multiple awaits. See the migration plan's "Technical decisions" section for
 * the full reasoning.
 *
 * CORRECTION found during Phase 1: `db.transaction()` is NOT available on this driver —
 * neon-http's `transaction()` throws unconditionally ("No transactions support in
 * neon-http driver"). The real atomicity primitive here is `db.batch([...])`, which sends
 * several statements as one HTTP round trip that commits or fails together (but can't
 * branch mid-batch on an earlier statement's result). Use `db.batch()` for any same-request
 * atomic multi-table write — see `src/lib/platform/registry.ts`'s `deleteOrganization` for
 * the pattern.
 *
 * Nothing in the currently-running app imports this yet (Phase 0 is purely additive) —
 * this file exists so `drizzle-kit push`/`studio` and the Phase 0 verification script
 * have a client to use, and so later phases have a stable import to build on.
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "Missing DATABASE_URL environment variable — this is the pooled Neon Postgres connection string."
  );
}

const sql = neon(connectionString);

export const db = drizzle(sql, { schema });
