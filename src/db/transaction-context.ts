import { AsyncLocalStorage } from "node:async_hooks";

type AdapterOptions<Db extends object, Tx extends object> = {
  db: Db;
  /** Resolves only after COMMIT; rejects after ROLLBACK (including rollback failures). */
  transact: <T>(work: (db: Tx) => Promise<T>) => Promise<T>;
  admit: (db: Tx, orgId: string) => Promise<void>;
  savepoint: <T>(db: Tx, work: (db: Tx) => Promise<T>) => Promise<T>;
};

/**
 * Pure injection boundary: importing this module never reads env or creates sockets.
 * Construct AND execute builders inside their owning scope; never let transaction
 * builders/callback clients escape it or start detached asynchronous work. Awaited
 * sibling batch/transaction regions serialize; nested callbacks use child queues.
 * A held region cannot await a later queued sibling: that sibling waits for the
 * held region to finish, so awaiting it creates an application-level deadlock.
 * Ordinary queries are not independent savepoint regions: do not interleave them
 * with a recoverable region in another concurrent branch on the same connection.
 */
export function createTenantTransactionAdapter<Db extends object, Tx extends object>(
  options: AdapterOptions<Db, Tx>,
) {
  type Effect = () => void | Promise<void>;
  type Scope = { orgId: string; db: Tx; effects: Set<Effect>; savepointTail: Promise<void> };
  const context = new AsyncLocalStorage<Scope>();
  function inSavepoint<T>(active: Scope, work: () => Promise<T>): Promise<T> {
    // Hold the queue through RELEASE/ROLLBACK, not just the callback. Installed
    // NeonTransaction reuses sp1 for siblings; unique names wouldn't isolate
    // overlapping PostgreSQL savepoint lifetimes either.
    const result = active.savepointTail.then(async () => {
      const effects = new Set<Effect>();
      const value = await options.savepoint(active.db, (tx) =>
        // A child owns its own queue and Drizzle nestedIndex. Reentrant callbacks
        // must not await the parent's queue (which is waiting for this callback).
        context.run({ ...active, db: tx, effects, savepointTail: Promise.resolve() }, work),
      );
      // Promote only after successful RELEASE, into the immediate parent. A
      // later parent rollback must also discard successfully released descendants.
      for (const effect of effects) active.effects.add(effect);
      return value;
    });
    active.savepointTail = result.then(() => undefined, () => undefined);
    return result;
  }
  const activeDb = () => context.getStore()?.db ?? options.db;
  function resolve(path: readonly PropertyKey[]): object {
    let current: object = activeDb();
    for (const property of path) current = Reflect.get(current, property, current) as object;
    return current;
  }
  function proxy(target: object, path: readonly PropertyKey[]): object {
    return new Proxy(target, {
      get(_target, property) {
        if (path.length === 0 && property === "batch") {
          return (items: readonly { execute: () => Promise<unknown> }[]) => {
            const active = context.getStore();
            if (!active) return Reflect.apply(Reflect.get(options.db, "batch") as (...args: unknown[]) => unknown, options.db, [items]);
            return inSavepoint(active, async () => {
              const results: unknown[] = [];
              for (const item of items) results.push(await item.execute());
              return results;
            });
          };
        }
        if (path.length === 0 && property === "transaction") {
          return (work: (tx: Tx) => Promise<unknown>, ...args: unknown[]) => {
            const active = context.getStore();
            if (!active) return Reflect.apply(Reflect.get(options.db, "transaction") as (...args: unknown[]) => unknown, options.db, [work, ...args]);
            return inSavepoint(active, () => work(proxy(activeDb(), []) as Tx));
          };
        }
        const current = resolve(path);
        const value: unknown = Reflect.get(current, property, current);
        if (property === "query" || (path[0] === "query" && typeof value === "object" && value !== null)) {
          return proxy(value as object, [...path, property]);
        }
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const receiver = resolve(path);
          return Reflect.apply(Reflect.get(receiver, property, receiver), receiver, args);
        };
      },
    });
  }
  const db = proxy(options.db, []) as Db;
  return {
    db,
    isInTenantTransaction: () => context.getStore() !== undefined,
    async afterTenantCommit(effect: Effect): Promise<void> {
      const active = context.getStore();
      if (active) active.effects.add(effect);
      else await effect();
    },
    async runInTenantTransaction<T>(orgId: string, work: () => Promise<T>): Promise<T> {
      if (!orgId.trim()) throw new Error("orgId must be non-empty");
      const active = context.getStore();
      if (active) {
        if (active.orgId !== orgId) throw new Error("Cross-tenant nested transaction is forbidden");
        return work();
      }
      const effects = new Set<Effect>();
      let result: T;
      let workCompleted = false;
      const failures: unknown[] = [];
      try {
        result = await options.transact(async (tx) => {
          await options.admit(tx, orgId);
          const value = await context.run({ orgId, db: tx, effects, savepointTail: Promise.resolve() }, work);
          workCompleted = true;
          return value;
        });
      } catch (error) {
        // A binding may report cleanup failure after a confirmed COMMIT.
        if (!workCompleted || typeof error !== "object" || error === null || !("committed" in error) || error.committed !== true || !("result" in error)) throw error;
        result = error.result as T;
        failures.push(error);
      }
      for (const effect of effects) {
        try { await effect(); } catch (error) { failures.push(error); }
      }
      if (failures.length) {
        throw Object.assign(new AggregateError(failures, "Transaction committed; post-commit effects failed"), {
          committed: true as const, result,
        });
      }
      return result;
    },
  };
}
