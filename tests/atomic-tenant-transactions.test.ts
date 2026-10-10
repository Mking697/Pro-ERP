import { describe, expect, it, vi } from "vitest";

function database(label: string) {
  return {
    label,
    execute: vi.fn(async function (this: { label: string }, value: unknown) {
      return { rows: [{ label: this.label, value }], rowCount: 1 };
    }),
    query: { items: { findMany: vi.fn(async () => [{ label }]) } },
    batch: vi.fn(async (items: readonly Promise<unknown>[]) => Promise.all(items)),
  };
}

async function fixture(releaseError?: Error) {
  const { createTenantTransactionAdapter } = await import("../src/db/transaction-context");
  const http = database("http");
  const transactions: ReturnType<typeof database>[] = [];
  const events: string[] = [];
  const adapter = createTenantTransactionAdapter({
    db: http,
    transact: async <T>(work: (db: typeof http) => Promise<T>): Promise<T> => {
      const tx = database(`tx${transactions.length}`);
      transactions.push(tx);
      events.push("begin");
      try {
        const result = await work(tx);
        events.push("commit");
        return result;
      } catch (error) {
        events.push("rollback");
        throw error;
      }
    },
    admit: async (_db: typeof http, orgId: string) => { events.push(`lock:${orgId}`); },
    savepoint: async <T>(tx: typeof http, work: (tx: typeof http) => Promise<T>): Promise<T> => {
      events.push("savepoint");
      try {
        const result = await work(tx);
        events.push("release");
        if (releaseError) throw releaseError;
        return result;
      } catch (error) {
        events.push("rollback-savepoint");
        throw error;
      }
    },
  });
  return { adapter, http, transactions, events };
}

describe("tenant transaction adapter", () => {
  it("preserves the HTTP batch implementation outside a scope", async () => {
    const { adapter, http, events } = await fixture();
    expect(await adapter.db.batch([Promise.resolve(1), Promise.resolve("two")])).toEqual([1, "two"]);
    expect(http.batch).toHaveBeenCalledOnce();
    expect(events).toEqual([]);
  });

  it("serializes awaited sibling batches through rollback and continues the queue", async () => {
    const { adapter, events } = await fixture();
    await adapter.runInTenantTransaction("org-a", async () => {
      const first = adapter.db.batch([{ execute: async () => "one" }] as never);
      const failed = adapter.db.batch([{ execute: async () => { throw new Error("SQL failure"); } }] as never).catch(() => "caught");
      const third = adapter.db.batch([{ execute: async () => "three" }] as never);
      expect(await Promise.all([first, failed, third])).toEqual([["one"], "caught", ["three"]]);
    });
    expect(events).toEqual(["begin", "lock:org-a", "savepoint", "release", "savepoint", "rollback-savepoint", "savepoint", "release", "commit"]);
  });

  it("executes batches in order under a savepoint without independent commits", async () => {
    const { adapter, http, events } = await fixture();
    const order: number[] = [];
    const items = [1, 2].map((n) => ({ execute: async () => { order.push(n); return n; } }));
    await adapter.runInTenantTransaction("org-a", async () => {
      // Real Drizzle batch items are lazy builders, not eager Promises.
      expect(await adapter.db.batch(items as never)).toEqual([1, 2]);
      expect(events).toEqual(["begin", "lock:org-a", "savepoint", "release"]);
    });
    expect(order).toEqual([1, 2]);
    expect(http.batch).not.toHaveBeenCalled();
    expect(events.at(-1)).toBe("commit");
  });

  it("recovers a failed numbering batch before a caught unique-error retry", async () => {
    const { adapter, events } = await fixture();
    const duplicate = Object.assign(new Error("duplicate"), { code: "23505" });
    let partial = 0;
    await adapter.runInTenantTransaction("org-a", async () => {
      await expect(adapter.db.batch([
        { execute: async () => { throw duplicate; } },
        { execute: async () => { partial++; } },
      ] as never)).rejects.toBe(duplicate);
      expect(events.at(-1)).toBe("rollback-savepoint");
      expect(await adapter.db.batch([{ execute: async () => "retry-ok" }] as never)).toEqual(["retry-ok"]);
    });
    expect(partial).toBe(0);
    expect(events).toEqual(["begin", "lock:org-a", "savepoint", "rollback-savepoint", "savepoint", "release", "commit"]);
  });

  it("defers and identity-deduplicates effects until commit including same-tenant nesting", async () => {
    const { adapter, events } = await fixture();
    const effect = vi.fn(async () => { events.push("effect"); expect(adapter.isInTenantTransaction()).toBe(false); });
    await adapter.runInTenantTransaction("org-a", async () => {
      await adapter.afterTenantCommit(effect);
      await adapter.runInTenantTransaction("org-a", async () => { await adapter.afterTenantCommit(effect); });
      expect(effect).not.toHaveBeenCalled();
    });
    expect(effect).toHaveBeenCalledOnce();
    expect(events).toEqual(["begin", "lock:org-a", "commit", "effect"]);
    await adapter.afterTenantCommit(effect);
    expect(effect).toHaveBeenCalledTimes(2);
  });

  it("discards effects from a caught callback rollback but retains outer effects", async () => {
    const { adapter, events } = await fixture();
    const outer = vi.fn();
    const inner = vi.fn();
    const transaction = (adapter.db as unknown as { transaction: (work: () => Promise<void>) => Promise<void> }).transaction;
    await adapter.runInTenantTransaction("org-a", async () => {
      await adapter.afterTenantCommit(outer);
      await expect(transaction(async () => {
        await adapter.afterTenantCommit(inner);
        throw new Error("callback abort");
      })).rejects.toThrow("callback abort");
      await adapter.db.execute("outer continues");
    });
    expect(events.at(-1)).toBe("commit");
    expect(outer).toHaveBeenCalledOnce();
    expect(inner).not.toHaveBeenCalled();
  });

  it("discards effects from a caught batch rollback", async () => {
    const { adapter, events } = await fixture();
    const inner = vi.fn();
    await adapter.runInTenantTransaction("org-a", async () => {
      await expect(adapter.db.batch([
        { execute: async () => { await adapter.afterTenantCommit(inner); } },
        { execute: async () => { throw new Error("batch abort"); } },
      ] as never)).rejects.toThrow("batch abort");
      await adapter.db.execute("outer continues");
    });
    expect(events.at(-1)).toBe("commit");
    expect(inner).not.toHaveBeenCalled();
  });

  it("discards successful nested-region effects when their immediate parent rolls back", async () => {
    const { adapter, events } = await fixture();
    const inner = vi.fn();
    const transaction = (adapter.db as unknown as { transaction: (work: () => Promise<void>) => Promise<void> }).transaction;
    await adapter.runInTenantTransaction("org-a", async () => {
      await expect(transaction(async () => {
        await adapter.db.batch([{ execute: async () => { await adapter.afterTenantCommit(inner); } }] as never);
        throw new Error("parent abort");
      })).rejects.toThrow("parent abort");
    });
    expect(events).toEqual(["begin", "lock:org-a", "savepoint", "savepoint", "release", "rollback-savepoint", "commit"]);
    expect(inner).not.toHaveBeenCalled();
  });

  it("retains the same effect registered outside a failed inner region exactly once", async () => {
    const { adapter } = await fixture();
    const effect = vi.fn();
    await adapter.runInTenantTransaction("org-a", async () => {
      await adapter.afterTenantCommit(effect);
      await expect(adapter.db.batch([{ execute: async () => {
        await adapter.afterTenantCommit(effect);
        throw new Error("batch abort");
      } }] as never)).rejects.toThrow("batch abort");
    });
    expect(effect).toHaveBeenCalledOnce();
  });

  it("identity-deduplicates effects across successful regions after RELEASE", async () => {
    const { adapter, events } = await fixture();
    const effect = vi.fn(() => { expect(events.at(-1)).toBe("commit"); });
    const transaction = (adapter.db as unknown as { transaction: (work: () => Promise<void>) => Promise<void> }).transaction;
    await adapter.runInTenantTransaction("org-a", async () => {
      await transaction(async () => { await adapter.afterTenantCommit(effect); });
      await adapter.db.batch([{ execute: async () => { await adapter.afterTenantCommit(effect); } }] as never);
      expect(effect).not.toHaveBeenCalled();
    });
    expect(effect).toHaveBeenCalledOnce();
  });

  it("does not merge effects when savepoint completion fails after its callback succeeds", async () => {
    const releaseError = new Error("RELEASE failed");
    const { adapter, events } = await fixture(releaseError);
    const inner = vi.fn();
    const outer = vi.fn();
    await adapter.runInTenantTransaction("org-a", async () => {
      await adapter.afterTenantCommit(outer);
      await expect(adapter.db.batch([{ execute: async () => { await adapter.afterTenantCommit(inner); } }] as never)).rejects.toBe(releaseError);
    });
    expect(events).toEqual(["begin", "lock:org-a", "savepoint", "release", "rollback-savepoint", "commit"]);
    expect(outer).toHaveBeenCalledOnce();
    expect(inner).not.toHaveBeenCalled();
  });

  it("discards queued effects on rollback", async () => {
    const { adapter } = await fixture();
    const effect = vi.fn(async () => {});
    await expect(adapter.runInTenantTransaction("org-a", async () => {
      await adapter.afterTenantCommit(effect);
      throw new Error("abort");
    })).rejects.toThrow("abort");
    expect(effect).not.toHaveBeenCalled();
  });

  it("reports committed effect failures explicitly and still attempts other effects", async () => {
    const { adapter, events } = await fixture();
    const second = vi.fn(async () => {});
    const promise = adapter.runInTenantTransaction("org-a", async () => {
      await adapter.afterTenantCommit(async () => { throw new Error("email offline"); });
      await adapter.afterTenantCommit(second);
      return 42;
    });
    await expect(promise).rejects.toMatchObject({ committed: true, result: 42 });
    expect(second).toHaveBeenCalledOnce();
    expect(events).toEqual(["begin", "lock:org-a", "commit"]);
  });
  it("joins same-tenant nesting and rejects cross-tenant nesting before opening another connection", async () => {
    const { adapter, transactions, events } = await fixture();
    await adapter.runInTenantTransaction("org-a", async () => {
      await adapter.runInTenantTransaction("org-a", async () => {
        await adapter.db.execute("nested");
      });
      await expect(adapter.runInTenantTransaction("org-b", async () => {})).rejects.toThrow("Cross-tenant");
    });
    expect(transactions).toHaveLength(1);
    expect(events).toEqual(["begin", "lock:org-a", "commit"]);
  });

  it("isolates concurrent scopes, captured relational methods, and outside queries", async () => {
    const { adapter } = await fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const findMany = adapter.db.query.items.findMany;
    const first = adapter.runInTenantTransaction("org-a", async () => {
      await gate;
      return findMany();
    });
    const second = adapter.runInTenantTransaction("org-b", async () => {
      expect(await findMany()).toEqual([{ label: "tx1" }]);
      release();
    });
    expect(await findMany()).toEqual([{ label: "http" }]);
    await second;
    expect(await first).toEqual([{ label: "tx0" }]);
  });

  it("discards effects for a domain error that resembles a committed cleanup failure", async () => {
    const { adapter, events } = await fixture();
    const effect = vi.fn();
    const error = Object.assign(new Error("domain"), { committed: true, result: 42 });
    await expect(adapter.runInTenantTransaction("org-a", async () => {
      await adapter.afterTenantCommit(effect);
      throw error;
    })).rejects.toBe(error);
    expect(effect).not.toHaveBeenCalled();
    expect(events.at(-1)).toBe("rollback");
  });

  it("propagates domain failure and rolls back", async () => {
    const { adapter, events } = await fixture();
    const error = new Error("domain failure");
    await expect(adapter.runInTenantTransaction("org-a", async () => { throw error; })).rejects.toBe(error);
    expect(events).toEqual(["begin", "lock:org-a", "rollback"]);
  });

  it("rejects an empty tenant before acquisition", async () => {
    const { adapter, events } = await fixture();
    await expect(adapter.runInTenantTransaction("", async () => {})).rejects.toThrow("orgId");
    expect(events).toEqual([]);
  });
  it("keeps HTTP reads outside and routes declared work to the transaction after admission", async () => {
    const { adapter, http, transactions, events } = await fixture();
    expect(await adapter.db.execute("outside")).toEqual({ rows: [{ label: "http", value: "outside" }], rowCount: 1 });
    const execute = adapter.db.execute;
    const result = await adapter.runInTenantTransaction("org-a", async () => {
      expect(adapter.isInTenantTransaction()).toBe(true);
      expect(events).toEqual(["begin", "lock:org-a"]);
      return execute("inside");
    });
    expect(result).toEqual({ rows: [{ label: "tx0", value: "inside" }], rowCount: 1 });
    expect(await adapter.db.query.items.findMany()).toEqual([{ label: "http" }]);
    expect(http.execute).toHaveBeenCalledTimes(1);
    expect(transactions[0].execute).toHaveBeenCalledTimes(1);
    expect(adapter.isInTenantTransaction()).toBe(false);
    expect(events).toEqual(["begin", "lock:org-a", "commit"]);
  });
});
