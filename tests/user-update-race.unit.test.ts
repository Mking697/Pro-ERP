import { beforeEach, describe, expect, it, vi } from "vitest";

// Persistence/lock simulation only: the real user-domain functions execute below.
const h = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  type Predicate = (row: Row) => boolean;
  type Expression = { strings: readonly string[]; values: unknown[] };
  const state = {
    rows: [] as Row[], limit: 1 as number | null, seq: 0,
    pauseRead: undefined as undefined | ((rows: Row[]) => Promise<void>),
    contended: undefined as undefined | (() => void),
    writes: [] as Row[],
  };
  const queues = new Map<string, Promise<void>>();
  const locked = new Set<string>();
  const runInTenantTransaction = vi.fn(async (org: string, work: () => Promise<unknown>) => {
    const prior = queues.get(org) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => { release = resolve; });
    queues.set(org, prior.then(() => mine));
    if (locked.has(org)) state.contended?.();
    await prior;
    locked.add(org);
    const snapshot = structuredClone(state.rows);
    try { return await work(); }
    catch (error) { state.rows = snapshot; throw error; }
    finally { locked.delete(org); release(); }
  });
  const db = {
    select: () => ({ from: () => ({ where: (predicate: Predicate) => {
      const rows = structuredClone(state.rows.filter(predicate));
      return {
        then: (resolve: (rows: Row[]) => void, reject: (error: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
        limit: async (n: number) => {
          const pause = state.pauseRead;
          state.pauseRead = undefined;
          await pause?.(rows);
          return rows.slice(0, n);
        },
      };
    } }) }),
    insert: () => ({ values: (values: Row) => ({ returning: async () => {
      const row = { createdAt: new Date("2026-01-01"), tokenVersion: 0, deactivatedAt: null, ...values };
      state.rows.push(row);
      return structuredClone([row]);
    } }) }),
    update: () => ({ set: (values: Row) => ({ where: (predicate: Predicate) => ({ returning: async () => {
      const matched = state.rows.filter(predicate);
      for (const row of matched) {
        state.writes.push(values);
        for (const [key, value] of Object.entries(values)) {
          if (value === undefined) continue;
          if (value && typeof value === "object" && "strings" in value) {
            const expression = value as Expression;
            row[key] = Number(row.tokenVersion) + (expression.strings.join("").includes("+ 1") ? 1 : 0);
          } else row[key] = value;
        }
      }
      return structuredClone(matched);
    } }) }) }),
  };
  return { state, db, runInTenantTransaction };
});

vi.mock("@/db/client", () => ({ db: h.db, runInTenantTransaction: h.runInTenantTransaction }));
vi.mock("@/db/schema", () => ({ users: new Proxy({}, { get: (_target, key) => key }) }));
vi.mock("drizzle-orm", () => ({
  eq: (key: string, value: unknown) => (row: Record<string, unknown>) => row[key] === value,
  and: (...predicates: (((row: Record<string, unknown>) => boolean) | undefined)[]) =>
    (row: Record<string, unknown>) => predicates.every((predicate) => !predicate || predicate(row)),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => {
    if (strings.join("").includes("exists")) {
      const org = values[2];
      const id = values[6];
      return () => h.state.rows.some((row) => row.orgId === org && row.id !== id && row.role === "Admin" && row.status === "Active");
    }
    return { strings, values };
  },
}));
vi.mock("bcryptjs", () => ({ default: { hash: async () => "HASH", compare: async () => true } }));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "ORG1" }));
vi.mock("@/lib/id", () => ({ generateId: () => `created-${++h.state.seq}` }));
vi.mock("@/lib/platform/planLimits", () => ({ getPlanLimit: () => ({ maxActiveUsers: h.state.limit }) }));
vi.mock("@/lib/moduleAccess", () => ({ serializeModuleAccess: (keys: readonly string[]) => keys.join(",") }));
vi.mock("@/lib/platform/registry", () => ({
  getOrganization: async () => ({ plan: "Growth" }), isEmailTaken: async () => false,
  indexUser: vi.fn(async () => {}), removeIndexedUser: vi.fn(async () => {}),
  updateIndexedUserStatus: vi.fn(async () => {}),
}));

const { createUser, updateUser, UserDeletionError } = await import("@/lib/auth/users");
const { updateIndexedUserStatus } = await import("@/lib/platform/registry");

function seed(id: string, overrides: Record<string, unknown> = {}) {
  const row = {
    id, orgId: "ORG1", fullName: id, email: `${id}@example.com`, passwordHash: "HASH",
    role: "Staff", department: "Ops", phoneNumber: "123", status: "Active",
    createdAt: new Date("2026-01-01"), createdBy: "SYSTEM", moduleAccess: [],
    shift: "1", reportingManagerId: "", deactivatedAt: null, tokenVersion: 0, ...overrides,
  };
  h.state.rows.push(row);
  return row;
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
const replacement = () => createUser({ fullName: "Replacement", email: "replacement@example.com", password: "password", role: "Staff", department: "Ops", phoneNumber: "123", createdBy: "SYSTEM" });

describe("OPS-03 authoritative user update", () => {
  beforeEach(() => {
    h.state.rows = []; h.state.writes = []; h.state.limit = 1;
    h.state.pauseRead = undefined; h.state.contended = undefined;
    vi.clearAllMocks();
  });

  it("omits status from a department-only persistence patch", async () => {
    seed("profile");
    await updateUser("profile", { department: "Packing" });
    expect(h.state.writes[0]).not.toHaveProperty("status");
  });

  it("admits only one concurrent create/reactivate candidate for the final seat", async () => {
    h.state.limit = 2;
    seed("existing"); seed("disabled", { status: "Inactive", deactivatedAt: new Date("2026-02-01") });
    const results = await Promise.allSettled([replacement(), updateUser("disabled", { status: "Active" })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.message).toMatch(/active users ho sakte hain/);
    expect(h.state.rows.filter((row) => row.status === "Active")).toHaveLength(2);
  });

  it("rejects reactivation at cap without changing revocation or exit state", async () => {
    seed("existing");
    const exit = new Date("2026-02-01");
    seed("disabled", { status: "Inactive", deactivatedAt: exit, tokenVersion: 4 });
    await expect(updateUser("disabled", { status: "Active" })).rejects.toThrow(/active users ho sakte hain/);
    expect(h.state.rows.find((row) => row.id === "disabled")).toMatchObject({ status: "Inactive", deactivatedAt: exit, tokenVersion: 4 });
    expect(updateIndexedUserStatus).not.toHaveBeenCalled();
  });

  it("rechecks a concurrent same-user reactivation instead of rejecting an already admitted seat", async () => {
    seed("disabled", { status: "Inactive", deactivatedAt: new Date("2026-02-01") });
    const results = await Promise.all([
      updateUser("disabled", { status: "Active" }), updateUser("disabled", { status: "Active" }),
    ]);
    expect(results.map((row) => row.Token_Version)).toEqual([1, 1]);
    expect(h.state.rows[0]).toMatchObject({ status: "Active", deactivatedAt: null, tokenVersion: 1 });
    expect(updateIndexedUserStatus).toHaveBeenCalledTimes(1);
  });

  it("allows at-cap profile and already-Active updates without consuming another seat", async () => {
    seed("existing", { tokenVersion: 3 });
    await updateUser("existing", { department: "Packing" });
    await updateUser("existing", { status: "Active" });
    expect(h.state.rows[0]).toMatchObject({ department: "Packing", status: "Active", tokenVersion: 3 });
    expect(updateIndexedUserStatus).not.toHaveBeenCalled();
  });

  it("keeps Trial/unlimited reactivation semantics", async () => {
    h.state.limit = null;
    seed("existing"); seed("disabled", { status: "Inactive" });
    await updateUser("disabled", { status: "Active" });
    expect(h.state.rows.filter((row) => row.status === "Active")).toHaveLength(2);
  });

  it.each([{ role: "Staff" }, { status: "Inactive" }])("refuses last-active-admin removal %j", async (patch) => {
    seed("admin", { role: "Admin", tokenVersion: 7 });
    await expect(updateUser("admin", patch)).rejects.toBeInstanceOf(UserDeletionError);
    expect(h.state.rows[0]).toMatchObject({ role: "Admin", status: "Active", tokenVersion: 7 });
    expect(updateIndexedUserStatus).not.toHaveBeenCalled();
  });

  it("retains one active Admin under concurrent demotions", async () => {
    seed("adminA", { role: "Admin" }); seed("adminB", { role: "Admin" });
    const results = await Promise.allSettled([
      updateUser("adminA", { role: "Staff" }), updateUser("adminB", { role: "Staff" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(h.state.rows.filter((row) => row.role === "Admin" && row.status === "Active")).toHaveLength(1);
  });

  it("preserves concurrent role/module changes and increments revocation once per genuine change", async () => {
    seed("staff", { tokenVersion: 4 });
    await Promise.all([
      updateUser("staff", { role: "Supervisor" }),
      updateUser("staff", { moduleAccess: ["inventory"] }),
      updateUser("staff", { department: "Packing" }),
    ]);
    expect(h.state.rows[0]).toMatchObject({ role: "Supervisor", moduleAccess: ["inventory"], department: "Packing", tokenVersion: 6 });
    await updateUser("staff", { role: "Supervisor", moduleAccess: ["inventory"] });
    expect(h.state.rows[0].tokenVersion).toBe(6);
  });

  it("does not restore stale Active status after deactivation and replacement admission", async () => {
    seed("old");
    const read = deferred(); const resume = deferred(); const contended = deferred();
    h.state.pauseRead = async () => { read.resolve(); await resume.promise; };
    h.state.contended = contended.resolve;
    const department = updateUser("old", { department: "Packing" });
    await read.promise;
    const successors = (async () => {
      await updateUser("old", { status: "Inactive" });
      await replacement();
    })();
    // Old code lets successors commit while the stale read is paused. Fixed code
    // blocks their authoritative read; release once contention is observed instead.
    await Promise.race([successors, contended.promise]);
    resume.resolve();
    await Promise.all([department, successors]);
    const old = h.state.rows.find((row) => row.id === "old");
    expect(old?.status).toBe("Inactive");
    expect(old?.department).toBe("Packing");
    expect(old?.tokenVersion).toBe(1);
    expect(old?.deactivatedAt).toBeInstanceOf(Date);
    expect(h.state.rows.filter((row) => row.status === "Active")).toHaveLength(1);
    expect(updateIndexedUserStatus).toHaveBeenCalledExactlyOnceWith("old@example.com", "Inactive");
  });
});
