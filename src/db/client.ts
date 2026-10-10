import { neon, Pool, type PoolClient } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";
import { drizzle as httpDrizzle } from "drizzle-orm/neon-http";
import { drizzle as pooledDrizzle } from "drizzle-orm/neon-serverless";
import * as schema from "@/db/schema";
import { createTenantTransactionAdapter } from "./transaction-context";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Missing DATABASE_URL environment variable — this is the pooled Neon Postgres connection string.");
}

const http = httpDrizzle(neon(connectionString), { schema });
type PooledDb = ReturnType<typeof pooledDrizzle<typeof schema>>;
type Transaction = Parameters<Parameters<PooledDb["transaction"]>[0]>[0];

const adapter = createTenantTransactionAdapter({
  db: http,
  async transact<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    // Request-owned pool: no cached connection or provider configuration changes.
    const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000 });
    let client: PoolClient | undefined;
    let result!: T;
    let committed = false;
    let failed = false;
    let failure: unknown;
    const cleanupFailures: unknown[] = [];
    try {
      client = await pool.connect();
      result = await pooledDrizzle(client, { schema }).transaction(async (tx) => {
        try { return await work(tx); }
        catch (error) {
          // Installed Drizzle can replace a domain error with a ROLLBACK error.
          failed = true;
          failure = error;
          throw error;
        }
      }, { isolationLevel: "read committed" });
      committed = true;
    } catch (error) {
      if (!failed) { failed = true; failure = error; }
    } finally {
      try { client?.release(); } catch (error) { cleanupFailures.push(error); }
      try { await pool.end(); } catch (error) { cleanupFailures.push(error); }
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
