import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  events: [] as string[], configs: [] as unknown[], queries: [] as unknown[],
  rollbackFailure: false, endFailure: false,
}));
vi.mock("@neondatabase/serverless", () => ({
  neon: vi.fn(() => "http-sql"),
  Pool: class {
    constructor(config: unknown) { state.configs.push(config); }
    async connect() { state.events.push("connect"); return { release: () => { state.events.push("release"); } }; }
    async end() { state.events.push("end"); if (state.endFailure) throw new Error("cleanup failed"); }
  },
}));
vi.mock("drizzle-orm/neon-http", () => ({ drizzle: () => ({ execute: async () => "http" }) }));
vi.mock("drizzle-orm/neon-serverless", () => ({ drizzle: () => ({
  transaction: async (work: (tx: unknown) => Promise<unknown>, config: unknown) => {
    state.queries.push(config); state.events.push("begin");
    const tx = { execute: async (query: unknown) => { state.queries.push(query); return "tx"; }, transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx) };
    try { const result = await work(tx); state.events.push("commit"); return result; }
    catch (error) { state.events.push("rollback"); if (state.rollbackFailure) throw new Error("rollback failed"); throw error; }
  },
}) }));
vi.mock("@/db/schema", () => ({}));
async function client() {
  vi.resetModules(); state.events = []; state.configs = []; state.queries = [];
  vi.stubEnv("DATABASE_URL", "postgresql://test.invalid/test");
  return import("../src/db/client");
}
afterEach(() => { vi.unstubAllEnvs(); state.rollbackFailure = false; state.endFailure = false; });
describe("tenant client bindings", () => {
  it("keeps outside reads HTTP and uses bounded pooled READ COMMITTED with parameterized tenant admission", async () => {
    const c = await client();
    expect(await c.db.execute({} as never)).toBe("http");
    expect(state.configs).toEqual([]);
    await c.runInTenantTransaction("org-'unsafe", async () => { expect(await c.db.execute({} as never)).toBe("tx"); });
    expect(state.configs).toEqual([{ connectionString: "postgresql://test.invalid/test", max: 1, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000 }]);
    expect(state.queries[0]).toEqual({ isolationLevel: "read committed" });
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const queries = state.queries.slice(1, 3).map((q) => new PgDialect().sqlToQuery(q as never));
    expect(queries[0].sql).toContain("set_config");
    expect(queries[0].params).toEqual(["5000ms", "30000ms"]);
    expect(queries[1].sql).toContain("pg_advisory_xact_lock");
    expect(queries[1].sql).not.toContain("unsafe");
    expect(queries[1].params).toEqual(["org-'unsafe"]);
    expect(state.events).toEqual(["connect", "begin", "commit", "release", "end"]);
  });
  it("preserves domain failure even when driver rollback and pool cleanup fail", async () => {
    const c = await client(); state.rollbackFailure = true; state.endFailure = true;
    const failure = new Error("domain");
    await expect(c.runInTenantTransaction("org-a", async () => { throw failure; })).rejects.toBe(failure);
    expect(state.events).toEqual(["connect", "begin", "rollback", "release", "end"]);
  });
  it("marks cleanup failure as committed and still executes deferred effects", async () => {
    const c = await client(); state.endFailure = true;
    const effect = vi.fn();
    await expect(c.runInTenantTransaction("org-a", async () => { await c.afterTenantCommit(effect); return 42; })).rejects.toMatchObject({ committed: true, result: 42 });
    expect(effect).toHaveBeenCalledOnce();
    expect(state.events).not.toContain("rollback");
  });
});
