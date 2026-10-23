import { Pool, type PoolClient } from "pg";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { createTenantTransactionAdapter } from "./transaction-context";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Missing DATABASE_URL environment variable — a plain Postgres connection string.");
}

/**
 * One shared, bounded connection pool for the whole process (plain `pg`, talking directly
 * to Postgres — no Neon driver, no Neon cloud, no local proxy sidecar). Ordinary reads use
 * the pool directly (node-postgres checks a connection out per query and returns it);
 * each tenant transaction below explicitly checks out its own dedicated client so the
 * entire transaction (admission lock + domain work) runs on one physical connection, same
 * guarantee the previous Neon-driver implementation gave via its own per-transaction Pool.
 * `DB_POOL_MAX` lets a deploy tune this without a code change if load needs more headroom.
 */
const pool = new Pool({
  connectionString,
  max: Number(process.env.DB_POOL_MAX ?? 10),
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

const plainDb = drizzle(pool, { schema });
/**
 * `node-postgres`'s drizzle db has no native `.batch()` (that's a Neon/libsql/D1-only
 * HTTP-batch feature) — but every `db.batch([...])` call site in this codebase runs
 * inside `runInTenantTransaction`, where `transaction-context.ts`'s own generic proxy
 * already intercepts `batch` and replays each item's `.execute()` sequentially inside a
 * savepoint (real Postgres transaction), never touching this driver-level method at all.
 * This type-only augmentation just lets those existing call sites keep compiling.
 */
type BatchItem = { execute: () => Promise<unknown> };
type Db = typeof plainDb & { batch: (items: readonly BatchItem[]) => Promise<unknown[]> };
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

const adapter = createTenantTransactionAdapter({
  db: plainDb as Db,
  async transact<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const client: PoolClient = await pool.connect();
    let result!: T;
    let committed = false;
    let failed = false;
    let failure: unknown;
    const cleanupFailures: unknown[] = [];
    try {
      result = await drizzle(client, { schema }).transaction(async (tx) => {
        try { return await work(tx); }
        catch (error) {
          // Drizzle can replace a domain error with a ROLLBACK error.
          failed = true;
          failure = error;
          throw error;
        }
      }, { isolationLevel: "read committed" });
      committed = true;
    } catch (error) {
      if (!failed) { failed = true; failure = error; }
    } finally {
      try { client.release(); } catch (error) { cleanupFailures.push(error); }
    }
    if (failed) throw failure;
    if (cleanupFailures.length) {
      throw Object.assign(new AggregateError(cleanupFailures, "Transaction committed; connection cleanup failed"), {
        committed, result,
      });
    }
    return result;
  },
  async admit(tx: Transaction, orgId: string) {
    // Transaction-local budgets precede the parameterized tenant-wide lock.
    await tx.execute(sql`select set_config('lock_timeout', ${"5000ms"}, true), set_config('statement_timeout', ${"30000ms"}, true)`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${orgId}, 0))`);
  },
  savepoint: <T>(tx: Transaction, work: (tx: Transaction) => Promise<T>) => tx.transaction(work),
});

/** HTTP outside a scope; resolves to the active transaction inside it. */
export const db = adapter.db;
export const runInTenantTransaction = adapter.runInTenantTransaction;
export const afterTenantCommit = adapter.afterTenantCommit;
export const isInTenantTransaction = adapter.isInTenantTransaction;
