import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { organizations } from "@/db/schema";

const prefix = `ORG-mutation-test-${randomUUID()}`;
const orgA = `${prefix}-a`;
const orgB = `${prefix}-b`;
const options = { operation: "payment.create.v1", actorId: "USR-test", key: "payment-1", payload: { amount: 10 } };

beforeAll(async () => {
  const target = new URL(process.env.DATABASE_URL!);
  if (target.hostname !== "pro-erp-regression-pg" || target.port !== "5432" || target.pathname !== "/pro_erp_test" || target.username !== "pro_erp_test") {
    throw new Error("Mutation tests require the approved disposable local database");
  }
  // Only the new receipt table: equivalent to the schema, not a migration.
  await db.execute(sql`create table if not exists mutation_receipts (
    org_id text not null references organizations(id), key text not null,
    actor_id text not null, operation text not null, payload_hash text not null,
    result jsonb not null, created_at timestamptz not null default now(),
    primary key (org_id, key)
  )`);
  await db.insert(organizations).values([orgA, orgB].map((id) => ({ id, orgName: "before", slug: id, ownerEmail: "mutation-test@example.invalid" })));
});

afterAll(async () => {
  // Exact owned IDs only. Never drop a shared table or touch other test tenants.
  await db.execute(sql`delete from mutation_receipts where org_id in (${orgA}, ${orgB})`);
  await db.delete(organizations).where(eq(organizations.id, orgA));
  await db.delete(organizations).where(eq(organizations.id, orgB));
  expect(await receiptCount(orgA, options.key)).toBe(0);
  const remaining = await db.execute(sql`select count(*)::int as count from mutation_receipts where org_id in (${orgA}, ${orgB})`);
  expect(remaining.rows[0].count).toBe(0);
  expect(await db.select().from(organizations).where(eq(organizations.id, orgA))).toHaveLength(0);
  expect(await db.select().from(organizations).where(eq(organizations.id, orgB))).toHaveLength(0);
});

async function receiptCount(orgId: string, key: string) {
  const result = await db.execute(sql`select count(*)::int as count from mutation_receipts where org_id = ${orgId} and key = ${key}`);
  return result.rows[0].count;
}

describe("mutation input and result contracts", () => {
  it.each([{ actorId: "" }, { actorId: " " }, { operation: "" }, { operation: " " }, { key: null }])("rejects missing binding metadata %#", async (change) => {
    const { runIdempotentTenantMutation } = await import("@/lib/mutations");
    await expect(runIdempotentTenantMutation(orgA, { ...options, ...change } as never, async () => ({}))).rejects.toMatchObject({ status: 400, code: "MUTATION_INPUT_INVALID" });
  });
  it.each(["\u0000", "\ud800", { "\u0000": "value" }])("rejects PostgreSQL-incompatible JSON text %# clearly", async (payload) => {
    const { runIdempotentTenantMutation } = await import("@/lib/mutations");
    await expect(runIdempotentTenantMutation(orgA, { ...options, payload }, async () => ({}))).rejects.toMatchObject({ status: 400, code: "MUTATION_INPUT_INVALID" });
  });
  it("extracts only a validated opaque header key without changing case", async () => {
    const { getMutationKey } = await import("@/lib/mutations");
    expect(getMutationKey(new Request("http://localhost"))).toBeUndefined();
    expect(getMutationKey(new Request("http://localhost", { headers: { "Idempotency-Key": "Pay_A:1" } }))).toBe("Pay_A:1");
    expect(() => getMutationKey(new Request("http://localhost", { headers: { "Idempotency-Key": "" } }))).toThrow(/key/i);
  });
  it.each(["", " ", " key", "key ", "a b", "a\n", "é", "x".repeat(201)])("rejects malformed supplied key %j before work", async (key) => {
    const { runIdempotentTenantMutation } = await import("@/lib/mutations");
    let calls = 0;
    await expect(runIdempotentTenantMutation(orgA, { ...options, key }, async () => { calls++; return {}; })).rejects.toMatchObject({ status: 400, code: "MUTATION_INPUT_INVALID" });
    expect(calls).toBe(0);
  });
  it.each([
    new Date(), undefined, NaN, Infinity, BigInt(1), { missing: undefined },
    [undefined], Array(1), () => 1, new Map(), Symbol("x"),
    Object.defineProperty({}, "hidden", { value: 1 }),
    Object.defineProperty({}, "getter", { enumerable: true, get() { throw new Error("must not run getter"); } }),
    { [Symbol("hidden")]: 1 },
  ])("rejects non-JSON payload %# before work", async (payload) => {
    const { runIdempotentTenantMutation } = await import("@/lib/mutations");
    let calls = 0;
    await expect(runIdempotentTenantMutation(orgA, { ...options, payload: payload as never }, async () => { calls++; return {}; })).rejects.toMatchObject({ status: 400, code: "MUTATION_INPUT_INVALID" });
    expect(calls).toBe(0);
  });
  it("rejects circular data clearly without recursive overflow", async () => {
    const { runIdempotentTenantMutation } = await import("@/lib/mutations");
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    await expect(runIdempotentTenantMutation(orgA, { ...options, payload: cycle as never }, async () => ({}))).rejects.toThrow(/circular/i);
  });
  it("rejects Date results and rolls back domain writes rather than replaying falsely typed dates", async () => {
    const { runIdempotentTenantMutation } = await import("@/lib/mutations");
    const [before] = await db.select().from(organizations).where(eq(organizations.id, orgA));
    await expect(runIdempotentTenantMutation(orgA, { ...options, key: "date-result" }, async () => {
      await db.update(organizations).set({ orgName: "invalid-result" }).where(eq(organizations.id, orgA));
      return { receivedAt: new Date() } as never;
    })).rejects.toThrow(/result.*JSON/i);
    const [after] = await db.select().from(organizations).where(eq(organizations.id, orgA));
    expect(after.orgName).toBe(before.orgName);
    expect(await receiptCount(orgA, "date-result")).toBe(0);
  });
});

describe("durable tenant mutation receipts (real PostgreSQL)", () => {
  it("concurrent mismatched payloads yield one committed winner and one 409 without duplicate work", async () => {
    const { runIdempotentTenantMutation, MutationConflictError } = await import("@/lib/mutations");
    let calls = 0;
    const results = await Promise.allSettled([10, 11].map((amount) => runIdempotentTenantMutation(orgA,
      { ...options, key: "concurrent-conflict", payload: { amount } }, async () => { calls++; return { amount }; })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(MutationConflictError);
    expect(calls).toBe(1);
    expect(await receiptCount(orgA, "concurrent-conflict")).toBe(1);
  });
  it("confirmed commit with a post-commit effect failure keeps its receipt for explicit replay", async () => {
    const { runIdempotentTenantMutation } = await import("@/lib/mutations");
    const { afterTenantCommit } = await import("@/db/client");
    let calls = 0;
    const opts = { ...options, key: "postcommit-fault" };
    await expect(runIdempotentTenantMutation(orgA, opts, async () => {
      calls++;
      await afterTenantCommit(() => { throw new Error("effect fault"); });
      return { paymentId: "committed" };
    })).rejects.toMatchObject({ committed: true, result: { paymentId: "committed" } });
    expect(await receiptCount(orgA, opts.key)).toBe(1);
    expect(await runIdempotentTenantMutation(orgA, opts, async () => { calls++; return { paymentId: "wrong" }; })).toEqual({ paymentId: "committed" });
    expect(calls).toBe(1);
  });
  it("array order is significant while plain JSON special keys, repeated references and negative zero round-trip", async () => {
    const { runIdempotentTenantMutation } = await import("@/lib/mutations");
    const shared = { marker: "😀" };
    const record = JSON.parse('{"__proto__":{"safe":true},"receivedAt":"2026-10-08T00:00:00.000Z"}');
    const opts = { ...options, key: "json-roundtrip", payload: { list: [1, 2], left: shared, right: shared } };
    const work = async () => ({ ...record, amount: -0 });
    const initial = await runIdempotentTenantMutation(orgA, opts, work);
    const replay = await runIdempotentTenantMutation(orgA, opts, work);
    expect(initial).toEqual(replay);
    expect(Object.hasOwn(replay, "__proto__")).toBe(true);
    expect(Object.is(replay.amount, -0)).toBe(false);
    await expect(runIdempotentTenantMutation(orgA, { ...opts, payload: { ...opts.payload, list: [2, 1] } }, work)).rejects.toMatchObject({ status: 409 });
  });
  it("stores JSON null results as JSONB null and replays without executing work", async () => {
    const { runIdempotentTenantMutation } = await import("@/lib/mutations");
    let calls = 0;
    const work = async () => { calls++; return null; };
    expect(await runIdempotentTenantMutation(orgA, { ...options, key: "null-result" }, work)).toBeNull();
    expect(await runIdempotentTenantMutation(orgA, { ...options, key: "null-result" }, work)).toBeNull();
    expect(calls).toBe(1);
  });
  it("same key in foreign tenants is independent; distinct case and keys allow equal-valued payments", async () => {
    const { runIdempotentTenantMutation } = await import("@/lib/mutations");
    let calls = 0;
    const work = async () => ({ paymentId: `PAY-${++calls}`, amount: 10 });
    const results = await Promise.all([
      runIdempotentTenantMutation(orgA, { ...options, key: "Equal-Value" }, work),
      runIdempotentTenantMutation(orgB, { ...options, key: "Equal-Value" }, work),
      runIdempotentTenantMutation(orgA, { ...options, key: "equal-value" }, work),
      runIdempotentTenantMutation(orgA, { ...options, key: "second-payment" }, work),
    ]);
    expect(calls).toBe(4);
    expect(new Set(results.map((result) => result.paymentId)).size).toBe(4);
    expect(await receiptCount(orgA, "Equal-Value")).toBe(1);
    expect(await receiptCount(orgB, "Equal-Value")).toBe(1);
  });
  it("work failure rolls back writes and leaves no receipt; same key retry can then succeed", async () => {
    const { runIdempotentTenantMutation } = await import("@/lib/mutations");
    const [before] = await db.select().from(organizations).where(eq(organizations.id, orgA));
    const fault = new Error("injected work fault");
    const opts = { ...options, key: "work-fault" };
    await expect(runIdempotentTenantMutation(orgA, opts, async () => {
      await db.update(organizations).set({ orgName: "must-rollback" }).where(eq(organizations.id, orgA));
      throw fault;
    })).rejects.toBe(fault);
    expect(await receiptCount(orgA, opts.key)).toBe(0);
    const [after] = await db.select().from(organizations).where(eq(organizations.id, orgA));
    expect(after.orgName).toBe(before.orgName);
    expect(await runIdempotentTenantMutation(orgA, opts, async () => ({ paymentId: "retry-ok" }))).toEqual({ paymentId: "retry-ok" });
    expect(await receiptCount(orgA, opts.key)).toBe(1);
  });
  it("missing key preserves transactional execution but never deduplicates", async () => {
    const { runIdempotentTenantMutation } = await import("@/lib/mutations");
    let calls = 0;
    const opts = { ...options, key: undefined };
    const work = async () => { calls++; return { amount: 10 }; };
    await runIdempotentTenantMutation(orgA, opts, work);
    await runIdempotentTenantMutation(orgA, opts, work);
    expect(calls).toBe(2);
    const [before] = await db.select().from(organizations).where(eq(organizations.id, orgA));
    await expect(runIdempotentTenantMutation(orgA, opts, async () => {
      await db.update(organizations).set({ orgName: "no-key-fault" }).where(eq(organizations.id, orgA));
      throw new Error("fault");
    })).rejects.toThrow("fault");
    const [after] = await db.select().from(organizations).where(eq(organizations.id, orgA));
    expect(after.orgName).toBe(before.orgName);
  });
  it("rejects nested entry before domain work to prevent unsafe joined-transaction replays", async () => {
    const { runIdempotentTenantMutation } = await import("@/lib/mutations");
    const { runInTenantTransaction } = await import("@/db/client");
    let calls = 0;
    await runInTenantTransaction(orgA, async () => {
      await expect(runIdempotentTenantMutation(orgA, { ...options, key: "nested" }, async () => { calls++; return {}; })).rejects.toThrow(/top-level/i);
    });
    expect(calls).toBe(0);
    expect(await receiptCount(orgA, "nested")).toBe(0);
  });
  it("organization deletion removes its receipts before the FK parent without touching another tenant", async () => {
    const { runIdempotentTenantMutation } = await import("@/lib/mutations");
    const { deleteOrganization } = await import("@/lib/platform/registry");
    await runIdempotentTenantMutation(orgA, { ...options, key: "delete-other-tenant" }, async () => ({ paymentId: "keep" }));
    await runIdempotentTenantMutation(orgB, { ...options, key: "delete-org" }, async () => ({ paymentId: "delete-org" }));
    await deleteOrganization(orgB);
    expect(await receiptCount(orgB, "delete-org")).toBe(0);
    expect(await db.select().from(organizations).where(eq(organizations.id, orgB))).toHaveLength(0);
    expect(await db.select().from(organizations).where(eq(organizations.id, orgA))).toHaveLength(1);
    expect(await receiptCount(orgA, "delete-other-tenant")).toBe(1);
  });
  it("canonical payload order replays but actor, operation and payload mismatches are typed conflicts", async () => {
    const { runIdempotentTenantMutation, MutationConflictError } = await import("@/lib/mutations");
    const bound = { ...options, key: "bound", payload: { amount: 10, details: { b: 2, a: 1 } } };
    await runIdempotentTenantMutation(orgA, bound, async () => ({ paymentId: "bound" }));
    let calls = 0;
    const replay = () => { calls++; return Promise.resolve({ paymentId: "wrong" }); };
    expect(await runIdempotentTenantMutation(orgA, { ...bound, payload: { details: { a: 1, b: 2 }, amount: 10 } }, replay)).toEqual({ paymentId: "bound" });
    for (const change of [{ actorId: "USR-other" }, { operation: "payment.delete.v1" }, { payload: { amount: 11 } }]) {
      const error = await runIdempotentTenantMutation(orgA, { ...bound, ...change }, replay).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(MutationConflictError);
      expect(error).toMatchObject({ status: 409, code: "MUTATION_CONFLICT" });
    }
    expect(calls).toBe(0);
  });
  it("concurrent identical keys execute domain work once and replay the stored JSON record", async () => {
    const { runIdempotentTenantMutation } = await import("@/lib/mutations");
    let calls = 0;
    const work = async () => {
      calls++;
      await db.update(organizations).set({ orgName: "paid" }).where(eq(organizations.id, orgA));
      await db.execute(sql`select pg_sleep(0.05)`);
      return { paymentId: "PAY-test", amount: 10, receivedAt: "2026-10-08T00:00:00.000Z" };
    };
    const results = await Promise.all(Array.from({ length: 4 }, () => runIdempotentTenantMutation(orgA, options, work)));
    expect(calls).toBe(1);
    expect(results).toEqual(Array(4).fill({ paymentId: "PAY-test", amount: 10, receivedAt: "2026-10-08T00:00:00.000Z" }));
    expect(typeof results[1].receivedAt).toBe("string");
    expect(await receiptCount(orgA, options.key)).toBe(1);
  });
});
