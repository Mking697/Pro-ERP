import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * OPS-03: the active-user plan cap (src/lib/auth/users.ts) was enforced on CREATE but not
 * on REACTIVATE (status Inactive -> Active via updateUser()) — an org already at its
 * plan's cap could reactivate a disabled user and exceed it. The fix applies the same
 * cap check to both paths, serialized per-org via runInTenantTransaction() (the same
 * pg_advisory_xact_lock-backed primitive src/db/client.ts already exposes for exactly
 * this class of "org-level admission decision" problem), so two concurrent requests
 * racing for the organization's last available slot cannot both read "under the cap"
 * before either writes.
 *
 * DB-free: @/db/client is replaced with an in-memory store plus a per-org FIFO queue
 * standing in for the real advisory lock — each queued "transaction" only runs its work
 * after the previous one for the same org has fully finished, so a later call's read
 * always observes an earlier call's already-applied write, exactly like two real
 * Postgres transactions serialized by the same advisory lock under read-committed
 * isolation.
 */
const h = vi.hoisted(() => {
  const state = {
    users: [] as Record<string, unknown>[],
    org: { id: "ORG1", plan: "Growth" } as { id: string; plan: string },
    planLimit: { maxActiveUsers: null as number | null, maxCompanies: null, trialDays: null },
    seq: 0,
  };

  const queueByOrg = new Map<string, Promise<void>>();
  const runInTenantTransaction = vi.fn(async (orgId: string, work: () => Promise<unknown>) => {
    const prior = queueByOrg.get(orgId) ?? Promise.resolve();
    let release: () => void = () => {};
    const mine = new Promise<void>((resolve) => {
      release = resolve;
    });
    queueByOrg.set(
      orgId,
      prior.then(() => mine)
    );
    await prior;
    try {
      return await work();
    } finally {
      release();
    }
  });

  type Row = Record<string, unknown>;
  type Predicate = (row: Row) => boolean;

  // Supports both `await ...where(predicate)` (plain array) and the chained
  // `...where(predicate).limit(n)` real code also uses (e.g. getUserRow()).
  function queryable(rows: Row[]) {
    return {
      then: (resolve: (v: Row[]) => void, reject: (e: unknown) => void) =>
        Promise.resolve(rows).then(resolve, reject),
      limit: (n: number) => Promise.resolve(rows.slice(0, n)),
    };
  }

  const db = {
    select: () => ({
      from: () => ({
        where: (predicate: Predicate) => queryable(state.users.filter(predicate)),
      }),
    }),
    insert: () => ({
      values: (vals: Row) => ({
        returning: async () => {
          const row = { tokenVersion: 0, moduleAccess: [], ...vals };
          state.users.push(row);
          return [row];
        },
      }),
    }),
    update: () => ({
      set: (vals: Row) => ({
        where: (predicate: Predicate) => ({
          returning: async () => {
            const matched = state.users.filter(predicate);
            for (const row of matched) Object.assign(row, vals);
            return matched;
          },
        }),
      }),
    }),
  };

  return { state, runInTenantTransaction, db };
});

vi.mock("@/db/client", () => ({ db: h.db, runInTenantTransaction: h.runInTenantTransaction }));
vi.mock("@/db/schema", () => ({ users: new Proxy({}, { get: (_t, prop) => prop }) }));
vi.mock("drizzle-orm", () => ({
  eq: (key: string, value: unknown) => (row: Record<string, unknown>) => row[key] === value,
  and:
    (...preds: ((row: Record<string, unknown>) => boolean)[]) =>
    (row: Record<string, unknown>) =>
      preds.filter(Boolean).every((p) => p(row)),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ __sql: true, strings, values }),
}));
vi.mock("bcryptjs", () => ({ default: { hash: async () => "HASH", compare: async () => true } }));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => h.state.org.id }));
vi.mock("@/lib/id", () => ({ generateId: (prefix: string) => `${prefix}-${++h.state.seq}` }));
vi.mock("@/lib/moduleAccess", () => ({ serializeModuleAccess: () => "" }));
vi.mock("@/lib/platform/planLimits", () => ({ getPlanLimit: () => h.state.planLimit }));
vi.mock("@/lib/platform/registry", () => ({
  getOrganization: async (orgId: string) => (orgId === h.state.org.id ? h.state.org : null),
  isEmailTaken: async () => false,
  indexUser: vi.fn(async () => {}),
  removeIndexedUser: vi.fn(async () => {}),
  updateIndexedUserStatus: vi.fn(async () => {}),
}));

const { createUser, updateUser } = await import("@/lib/auth/users");

function seedUser(overrides: Record<string, unknown>) {
  const row = {
    id: `UID-seed-${h.state.seq++}`,
    orgId: h.state.org.id,
    fullName: "Seed",
    email: `seed-${h.state.seq}@example.com`,
    passwordHash: "HASH",
    role: "Staff",
    department: "Ops",
    phoneNumber: "9990000000",
    status: "Active",
    createdAt: new Date("2026-01-01"),
    createdBy: "SYSTEM",
    moduleAccess: [],
    shift: "1",
    reportingManagerId: "",
    deactivatedAt: null,
    tokenVersion: 0,
    ...overrides,
  };
  h.state.users.push(row);
  return row;
}

describe("active-user cap admission: create vs reactivate consistency", () => {
  beforeEach(() => {
    h.state.users.length = 0;
  });

  it("rejects reactivating a disabled user when the org is already at its active-user cap", async () => {
    h.state.planLimit = { maxActiveUsers: 1, maxCompanies: null, trialDays: null };
    const atCapUser = seedUser({ status: "Active" });
    const disabled = seedUser({ status: "Inactive" });

    await expect(updateUser(disabled.id as string, { status: "Active" })).rejects.toThrow(
      /active users ho sakte hain/
    );

    const stillDisabled = h.state.users.find((u) => u.id === disabled.id);
    expect(stillDisabled?.status).toBe("Inactive");
    const stillOnlyOneActive = h.state.users.filter((u) => u.status === "Active");
    expect(stillOnlyOneActive).toEqual([atCapUser]);
  });

  it("allows exactly one of two concurrent reactivations racing for the last available slot", async () => {
    h.state.planLimit = { maxActiveUsers: 2, maxCompanies: null, trialDays: null };
    seedUser({ status: "Active" }); // consumes slot 1 of 2
    const candidateA = seedUser({ status: "Inactive" });
    const candidateB = seedUser({ status: "Inactive" });

    const results = await Promise.allSettled([
      updateUser(candidateA.id as string, { status: "Active" }),
      updateUser(candidateB.id as string, { status: "Active" }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/active users ho sakte hain/);

    const activeNow = h.state.users.filter((u) => u.status === "Active");
    expect(activeNow.length).toBe(2); // never 3 — the cap held under real concurrency
  });

  it("regression: still rejects user creation when the org is already at its active-user cap", async () => {
    h.state.planLimit = { maxActiveUsers: 1, maxCompanies: null, trialDays: null };
    seedUser({ status: "Active" });

    await expect(
      createUser({
        fullName: "Over Cap",
        email: "over-cap@example.com",
        password: "Password123!",
        role: "Staff",
        department: "Ops",
        phoneNumber: "9990000099",
        createdBy: "SYSTEM",
      })
    ).rejects.toThrow(/active users ho sakte hain/);
  });
});
