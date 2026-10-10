import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { afterTenantCommit, db, runInTenantTransaction } from "../src/db/client";
import { drizzle } from "drizzle-orm/neon-serverless";

type Tx = Parameters<Parameters<ReturnType<typeof drizzle>["transaction"]>[0]>[0];
const scopedTx = db as unknown as Tx;
const capturedTransaction = scopedTx.transaction;

beforeEach(async () => {
  expect((await db.execute(sql`select current_database() name`)).rows[0].name).toBe("pro_erp_test");
});

it("serializes callback transactions with batches while allowing awaited nested work", async () => {
  await runInTenantTransaction("phase2-batch-callback", async () => {
    await db.execute(sql`create temporary table phase2_callback (id integer primary key)`);
    const first = capturedTransaction(async (tx) => {
      await tx.transaction(async (nested) => {
        await runInTenantTransaction("phase2-batch-callback", async () => {
          await db.batch([db.execute(sql`insert into phase2_callback values (1)`)]);
        });
        expect((await nested.execute(sql`select id from phase2_callback`)).rows).toEqual([{ id: 1 }]);
      });
      return tx.execute(sql`select id from phase2_callback`);
    });
    const fail = db.batch([{ execute: async () => {
      await first;
      return db.execute(sql`select 1 / 0`).execute();
    } }] as never).catch((error: unknown) => {
      expect(error).toMatchObject({ cause: { code: "22012" } });
      return "caught";
    });
    expect((await first).rows).toEqual([{ id: 1 }]);
    expect(await fail).toBe("caught");
    expect((await db.execute(sql`select id from phase2_callback`)).rows).toEqual([{ id: 1 }]);
  });
});

it("suppresses rolled-back savepoint effects after actual COMMIT and preserves committed rows", async () => {
  const tableName = `phase2_effect_${randomUUID().replaceAll("-", "")}`;
  const table = sql.identifier(tableName);
  const outer = vi.fn();
  const callbackEffect = vi.fn();
  const batchEffect = vi.fn();
  const nestedEffect = vi.fn();
  const successfulEffect = vi.fn();
  try {
    await runInTenantTransaction("phase2-savepoint-effects", async () => {
      await db.execute(sql`create table ${table} (id integer primary key)`);
      await afterTenantCommit(outer);
      await expect(capturedTransaction(async (tx) => {
        await afterTenantCommit(callbackEffect);
        await afterTenantCommit(outer);
        await tx.execute(sql`insert into ${table} values (2)`);
        throw new Error("callback abort");
      })).rejects.toThrow("callback abort");
      await expect(db.batch([
        { execute: async () => {
          await afterTenantCommit(batchEffect);
          return db.execute(sql`insert into ${table} values (3)`).execute();
        } },
        db.execute(sql`select 1 / 0`),
      ] as never)).rejects.toMatchObject({ cause: { code: "22012" } });
      await expect(capturedTransaction(async (tx) => {
        await tx.transaction(async (nested) => {
          await afterTenantCommit(nestedEffect);
          await nested.execute(sql`insert into ${table} values (4)`);
        });
        throw new Error("parent abort");
      })).rejects.toThrow("parent abort");
      await capturedTransaction(async (tx) => {
        await afterTenantCommit(successfulEffect);
        await tx.execute(sql`insert into ${table} values (1)`);
      });
      await db.batch([{ execute: async () => { await afterTenantCommit(successfulEffect); } }] as never);
      expect(outer).not.toHaveBeenCalled();
      expect(successfulEffect).not.toHaveBeenCalled();
      expect((await db.execute(sql`select id from ${table} order by id`)).rows).toEqual([{ id: 1 }]);
    });
    // Independent HTTP readback proves COMMIT, and the absence of rolled-back writes.
    expect((await db.execute(sql`select id from ${table} order by id`)).rows).toEqual([{ id: 1 }]);
    expect(outer).toHaveBeenCalledOnce();
    expect(successfulEffect).toHaveBeenCalledOnce();
    expect(callbackEffect).not.toHaveBeenCalled();
    expect(batchEffect).not.toHaveBeenCalled();
    expect(nestedEffect).not.toHaveBeenCalled();
  } finally {
    await db.execute(sql`drop table if exists ${table}`);
    expect((await db.execute(sql`select to_regclass(${tableName}) name`)).rows[0].name).toBeNull();
  }
});

it.each(["review schedule", "native overlap"])("commits the successful concurrent batch despite a caught sibling SQL failure (%s)", async (schedule) => {
  const tableName = `phase2_batch_${randomUUID().replaceAll("-", "")}`;
  const table = sql.identifier(tableName);
  try {
    await runInTenantTransaction("phase2-batch-concurrency", async () => {
      await db.execute(sql`create table ${table} (id integer primary key)`);
      // Actual installed NeonTransaction uses sp1 for both concurrent regions.
      const success = db.batch([db.execute(sql`insert into ${table} values (1) returning id`)]);
      const failingQuery = db.execute(sql`select 1 / 0`);
      const failure = (schedule === "native overlap" ? db.batch([failingQuery]) : db.batch([{ execute: async () => {
        // Force the reviewer's schedule: both SAVEPOINTs exist, then A
        // releases successfully before B's failure rolls back to its sp1.
        await success;
        return failingQuery.execute();
      } }] as never)).catch((error: unknown) => {
        expect(error).toMatchObject({ cause: { code: "22012" } });
        return "caught";
      });
      const [inserted, caught] = await Promise.all([success, failure]);
      expect(inserted[0].rows).toEqual([{ id: 1 }]);
      expect(caught).toBe("caught");
    });
    // New HTTP connection after COMMIT, not just a successful INSERT result.
    expect((await db.execute(sql`select id from ${table}`)).rows).toEqual([{ id: 1 }]);
  } finally {
    await db.execute(sql`drop table if exists ${table}`);
    expect((await db.execute(sql`select to_regclass(${tableName}) name`)).rows[0].name).toBeNull();
  }
});
