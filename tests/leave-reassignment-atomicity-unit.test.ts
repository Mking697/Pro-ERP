/* eslint-disable @typescript-eslint/no-explicit-any -- Minimal in-memory persistence fixture; application code remains fully typed. */
import { beforeEach, expect, it, vi } from "vitest";

type Row = Record<string, any>;

const s = vi.hoisted(() => ({
  rows: {} as Record<string, Row[]>,
  inTx: false,
  fault: "",
  readsOutsideTx: [] as string[],
}));

// Mirrors the generic in-memory-table mocking shape already established by
// tests/fms-maintenance.unit.test.ts: @/db/client's `db` is a tiny predicate-evaluating
// query engine over plain JS arrays, and `runInTenantTransaction` snapshots/restores
// `s.rows` around `work()` so a thrown error inside it behaves exactly like a real ROLLBACK.
vi.mock("@/db/client", async () => {
  const { getTableName } = await import("drizzle-orm");
  const evaluate = (node: any, row: Row): any => {
    if (node?.queryChunks) {
      const chunks = node.queryChunks;
      const text = chunks.map((c: any) => c.value?.join?.("") ?? "").join("");
      if (text.includes(" = ")) return evaluate(chunks[1], row) === evaluate(chunks[3], row);
      if (text.includes(" and ")) return chunks.filter((c: any) => c.queryChunks).every((c: any) => evaluate(c, row));
      if (text === "()") return evaluate(chunks[1], row);
      if (chunks.length === 1) return evaluate(chunks[0], row);
    }
    if (node?.table && node?.name) return row[node.name];
    if (node && "value" in node) return node.value;
    return node;
  };
  const domainRow = (row: Row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase()), v]));
  const query = (table: any, operation: string) => {
    const name = getTableName(table);
    let predicate: any;
    const builder: any = {
      where(p: any) { predicate = p; return builder; },
      async then(resolve: any, reject: any) {
        try {
          if (!s.inTx) s.readsOutsideTx.push(name);
          const matched = s.rows[name].filter((row) => !predicate || evaluate(predicate, domainRow(row)));
          resolve(matched.map((row) => structuredClone(row)));
        } catch (e) { reject(e); }
      },
    };
    return builder;
  };
  return {
    db: { select: () => ({ from: (table: any) => query(table, "select") }) },
    async runInTenantTransaction<T>(_orgId: string, work: () => Promise<T>): Promise<T> {
      if (s.inTx) return work();
      const snapshot = structuredClone(s.rows);
      s.inTx = true;
      try {
        return await work();
      } catch (error) {
        s.rows = snapshot;
        throw error;
      } finally {
        s.inTx = false;
      }
    },
    isInTenantTransaction: () => s.inTx,
  };
});

vi.mock("@/db/repo", async () => {
  const { getTableName } = await import("drizzle-orm");
  const check = (table: any, op: string) => {
    const name = getTableName(table);
    if (!s.inTx) s.readsOutsideTx.push(name);
    if (s.fault === `${op}:${name}`) throw new Error(`injected ${s.fault}`);
    return name;
  };
  return {
    findById: async (table: any, orgId: string, id: string) =>
      structuredClone(s.rows[check(table, "select")].find((r) => r.orgId === orgId && r.id === id)) ?? null,
    insertRecord: async (table: any, values: Row) => {
      const name = check(table, "insert");
      s.rows[name].push(structuredClone(values));
      return structuredClone(values);
    },
    updateById: async (table: any, orgId: string, id: string, patch: Row) => {
      const name = check(table, "update");
      const row = s.rows[name].find((r) => r.orgId === orgId && r.id === id);
      if (row) Object.assign(row, patch);
      return row ? structuredClone(row) : null;
    },
  };
});

vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "org" }));
vi.mock("@/lib/fms/engine", () => ({ recomputeRunTat: vi.fn(async () => {}) }));

import { activateLeave, resolveActiveAssignee } from "@/lib/leave/reassignment";

beforeEach(() => {
  s.rows = { leaves: [], tasks: [], fms_runs: [], leave_reassignments: [] };
  s.inTx = false;
  s.fault = "";
  s.readsOutsideTx = [];
});

function approvedLeave(overrides: Partial<Row> = {}): Row {
  return {
    id: "LV-1",
    orgId: "org",
    doerId: "doer",
    buddyId: "buddy",
    status: "Approved",
    activatedAt: null,
    revertedAt: null,
    ...overrides,
  };
}

// RED (this item's first behavior): a failure in the audit-log insert, happening after a
// task's reassignment write has already run, must not leave that reassignment standing —
// pre-fix (sequential, no enclosing transaction) the task row was left reassigned to the
// buddy with no leave_reassignments row ever recorded for it, and no exception reached the
// caller for the whole-leave-activation either (RED proves this is no longer possible, not
// what the old bug looked like — see the report for the actual pre-fix trace).
it("a failed audit insert rolls back an already-applied task reassignment, atomically", async () => {
  s.rows.leaves.push(approvedLeave());
  s.rows.tasks.push({ id: "TSK-1", orgId: "org", assignedTo: "doer", status: "Pending" });
  s.fault = "insert:leave_reassignments";

  await expect(activateLeave("LV-1")).rejects.toThrow("injected");

  // The task reassignment that ran before the failing audit insert must be rolled back too.
  expect(s.rows.tasks[0].assignedTo).toBe("doer");
  expect(s.rows.leave_reassignments).toHaveLength(0);
  // The leave itself must not be left half-activated either.
  expect(s.rows.leaves[0].activatedAt).toBeNull();
  // Every write happened inside the transaction (no reassignment ever observed by an
  // outside reader mid-flight) — the hallmark of genuine atomicity, not just a retry-safe
  // end state reached by luck.
  expect(s.readsOutsideTx).toEqual([]);
});

it("a successful activation reassigns the task and records its audit row together", async () => {
  s.rows.leaves.push(approvedLeave());
  s.rows.tasks.push({ id: "TSK-1", orgId: "org", assignedTo: "doer", status: "Pending" });

  await activateLeave("LV-1");

  expect(s.rows.tasks[0].assignedTo).toBe("buddy");
  expect(s.rows.leave_reassignments).toHaveLength(1);
  expect(s.rows.leave_reassignments[0]).toMatchObject({ entityType: "TASK", entityId: "TSK-1", buddyId: "buddy" });
  expect(s.rows.leaves[0].activatedAt).not.toBeNull();
});

// RED (this item's second behavior, the half this file DB-free tests directly):
// resolveActiveAssignee is the primitive the recurring generator now calls at the moment
// of creation. Pre-fix, nothing like this existed — a doer's Doer_ID was used verbatim
// regardless of any leave in progress.
it("resolveActiveAssignee returns the buddy while the doer's leave is activated and not reverted", async () => {
  s.rows.leaves.push(approvedLeave({ activatedAt: new Date(), revertedAt: null }));
  await expect(resolveActiveAssignee("org", "doer")).resolves.toBe("buddy");
});

it("resolveActiveAssignee returns the original user once the leave has reverted", async () => {
  s.rows.leaves.push(approvedLeave({ activatedAt: new Date(), revertedAt: new Date() }));
  await expect(resolveActiveAssignee("org", "doer")).resolves.toBe("doer");
});

it("resolveActiveAssignee returns the original user when the leave was never activated", async () => {
  s.rows.leaves.push(approvedLeave({ activatedAt: null, revertedAt: null }));
  await expect(resolveActiveAssignee("org", "doer")).resolves.toBe("doer");
});

it("resolveActiveAssignee is a no-op for a user with no leave at all", async () => {
  await expect(resolveActiveAssignee("org", "someone-else")).resolves.toBe("someone-else");
});
