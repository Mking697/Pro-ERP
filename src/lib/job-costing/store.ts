/**
 * J3 — additive isolated domain store for Recorded Job Cost Sheets: idempotent Draft
 * CRUD and readback over the `job_cost_sheets` table (`src/db/schema/jobCosting.ts`).
 *
 * Mirrors `src/lib/costing/domain.ts` + `src/lib/costing/service.ts`'s split exactly:
 * `createJobCostDraftDomain` is pure business logic over an injected `JobCostDraftStore`
 * (DB-free, directly unit-testable with a fixture store — see
 * `tests/job-costing-store.test.ts`), and `createDbJobCostDraftStore` is the one real
 * wiring implementation, imported dynamically so this module stays safe to import from a
 * DB-free test (same reasoning as `source.ts`'s `loadDbModule`).
 *
 * Deliberately NOT implemented here (reserved for J4): finalize, active lineage pointer
 * maintenance, source-allocation cap arithmetic/claims. `job_cost_lineages` and
 * `job_cost_source_allocations` exist in the schema but are never read/written by this
 * module. No HTTP routes/UI (J5) and no migration apply — see the module-level deviation
 * note at the bottom of this file for what J4 must still freeze.
 */
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { jobCostInputSchema } from "./validation";
import { calculateJobCost } from "./engine";
import { buildJobCostFacts, createDbJobSourceStore, JobSourceError, type JobSourceStore } from "./source";
import { generateId } from "@/lib/id";
import type { JobCostInput, JobCostSheet } from "./types";

export class JobCostStoreError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "JobCostStoreError";
  }
}

export interface JobCostActor {
  orgId: string;
  actorId: string;
}

const idText = z.string().min(1).max(200);
const createDraftSchema = z.object({ input: jobCostInputSchema, supersedesId: idText.optional() }).strict();
const versionSchema = z.object({ expectedVersion: z.number().int().min(1).max(2147483646) }).strict();
const updateDraftSchema = versionSchema.extend({ input: jobCostInputSchema }).strict();

export interface JobCostFactsParams {
  orgId: string;
  planId: string;
  asOfDate: string;
  capturedBy: string;
}

/** Everything the domain layer needs from persistence/source evidence, each method a
 * single tenant-scoped operation. `get`/`listByPlan` take `orgId` explicitly (not read off
 * ambient tenant context) so cross-tenant ownership is testable by fixture, not just by
 * production wiring. */
export interface JobCostDraftStore {
  authorize(): Promise<JobCostActor>;
  mutate<T>(actor: JobCostActor, operation: string, key: string, payload: unknown, work: () => Promise<T>): Promise<T>;
  buildFacts(params: JobCostFactsParams): ReturnType<typeof buildJobCostFacts>;
  get(orgId: string, id: string): Promise<JobCostSheet | null>;
  listByPlan(orgId: string, planId: string): Promise<JobCostSheet[]>;
  save(orgId: string, sheet: JobCostSheet): Promise<void>;
  nextId(): string;
  now(): string;
}

export interface JobCostDraftService {
  createDraft(raw: unknown, key: string): Promise<JobCostSheet>;
  getDraft(id: string): Promise<JobCostSheet | null>;
  listDraftsByPlan(planId: string): Promise<JobCostSheet[]>;
  updateDraft(id: string, raw: unknown, key: string): Promise<JobCostSheet>;
}

/** Pure domain logic over the injected store — no direct DB/HTTP/auth import, so a fixture
 * store (see the test file) exercises ownership/immutability/concurrency/idempotency/
 * rollback behavior without a real database. */
export function createJobCostDraftDomain(store: JobCostDraftStore): JobCostDraftService {
  async function mutation<T>(op: string, key: string, payload: unknown, work: (actor: JobCostActor) => Promise<T>): Promise<T> {
    if (!key) throw new JobCostStoreError("Idempotency-Key is required");
    const actor = await store.authorize();
    return store.mutate(actor, "job-costing.v1." + op, key, payload, async () => {
      // Re-authorize inside the mutation's transaction boundary — a revoked grant between
      // the first check and transaction admission must not let stale work commit.
      const live = await store.authorize();
      if (live.orgId !== actor.orgId || live.actorId !== actor.actorId) throw new JobCostStoreError("Forbidden", 403);
      return work(live);
    });
  }

  async function editableDraft(orgId: string, id: string, version: number): Promise<JobCostSheet> {
    const sheet = await store.get(orgId, id);
    if (!sheet) throw new JobCostStoreError("Job cost sheet not found", 404);
    if (sheet.status !== "Draft" || sheet.version !== version) {
      throw new JobCostStoreError("Job cost sheet is finalized or version is stale; reload", 409);
    }
    return sheet;
  }

  return {
    async createDraft(raw: unknown, key: string): Promise<JobCostSheet> {
      const payload = createDraftSchema.parse(raw);
      return mutation("create-draft", key, payload, async (actor) => {
        if (payload.supersedesId) {
          // Reserved for J4: no Finalized sheet can exist yet, so in practice this always
          // rejects today. Validated now (same-tenant/same-plan/Finalized) so the Draft
          // CRUD contract's supersedesId field is exercised honestly, not silently accepted
          // and ignored.
          const parent = await store.get(actor.orgId, payload.supersedesId);
          if (!parent || parent.status !== "Finalized" || parent.planId !== payload.input.planId) {
            throw new JobCostStoreError("Revision parent must be a finalized sheet of the same plan", 409);
          }
        }
        const calculation = await calculate(store, actor, payload.input);
        const prior = await store.listByPlan(actor.orgId, payload.input.planId);
        const revision = prior.reduce((max, s) => Math.max(max, s.revision), 0) + 1;
        if (revision > 2147483646) throw new JobCostStoreError("Revision limit reached", 409);
        const now = store.now();
        const sheet: JobCostSheet = {
          id: store.nextId(),
          planId: calculation.plan.planId,
          productSku: calculation.plan.productSku,
          revision,
          version: 1,
          status: "Draft",
          supersedesId: payload.supersedesId ?? null,
          calculation,
          createdBy: actor.actorId,
          createdAt: now,
          updatedAt: now,
          finalizedBy: null,
          finalizedAt: null,
        };
        await store.save(actor.orgId, sheet);
        return sheet;
      });
    },

    async getDraft(id: string): Promise<JobCostSheet | null> {
      idText.parse(id);
      const actor = await store.authorize();
      return store.get(actor.orgId, id);
    },

    async listDraftsByPlan(planId: string): Promise<JobCostSheet[]> {
      idText.parse(planId);
      const actor = await store.authorize();
      return store.listByPlan(actor.orgId, planId);
    },

    async updateDraft(id: string, raw: unknown, key: string): Promise<JobCostSheet> {
      idText.parse(id);
      const payload = updateDraftSchema.parse(raw);
      return mutation("update-draft", key, { id, ...payload }, async (actor) => {
        const previous = await editableDraft(actor.orgId, id, payload.expectedVersion);
        // Immutable identity: the plan this sheet is keyed to can never change on update —
        // a different planId belongs to a different sheet/revision lineage entirely.
        if (previous.planId !== payload.input.planId) throw new JobCostStoreError("Plan identity cannot change", 409);
        const calculation = await calculate(store, actor, payload.input);
        // productSku is server-derived from the plan's current Items-master row, not
        // client input; it must still never drift under the same sheet identity.
        if (calculation.plan.productSku !== previous.productSku) throw new JobCostStoreError("Product SKU cannot change", 409);
        const sheet: JobCostSheet = { ...previous, calculation, version: previous.version + 1, updatedAt: store.now() };
        await store.save(actor.orgId, sheet);
        return sheet;
      });
    },
  };
}

async function calculate(store: JobCostDraftStore, actor: JobCostActor, input: JobCostInput) {
  const facts = await store.buildFacts({ orgId: actor.orgId, planId: input.planId, asOfDate: input.asOfDate, capturedBy: actor.actorId });
  return calculateJobCost(input, facts);
}

// ---------------------------------------------------------------------------
// Production store — real schema reads/writes only, tenant-scoped by construction. Not
// exercised by the DB-free test suite; wiring is covered by the typecheck/lint gates only,
// same convention as `source.ts`'s `createDbJobSourceStore`.
// ---------------------------------------------------------------------------

let dbModulePromise: Promise<{
  db: typeof import("@/db/client").db;
  schema: typeof import("@/db/schema");
  runIdempotentTenantMutation: typeof import("@/lib/mutations").runIdempotentTenantMutation;
  generateId: typeof import("@/lib/id").generateId;
}> | null = null;
async function loadDbModule() {
  if (!dbModulePromise) {
    dbModulePromise = Promise.all([
      import("@/db/client"),
      import("@/db/schema"),
      import("@/lib/mutations"),
      import("@/lib/id"),
    ]).then(([client, schema, mutations, id]) => ({
      db: client.db,
      schema,
      runIdempotentTenantMutation: mutations.runIdempotentTenantMutation,
      generateId: id.generateId,
    }));
  }
  return dbModulePromise;
}

function dto(row: {
  id: string; planId: string; productSku: string; revision: number; version: number;
  status: "Draft" | "Finalized"; calculation: JobCostSheet["calculation"]; supersedesId: string | null;
  createdAt: Date; createdBy: string; updatedAt: Date; finalizedAt: Date | null; finalizedBy: string | null;
}): JobCostSheet {
  return {
    id: row.id, planId: row.planId, productSku: row.productSku, revision: row.revision, version: row.version,
    status: row.status, supersedesId: row.supersedesId, calculation: row.calculation,
    createdBy: row.createdBy, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    finalizedAt: row.finalizedAt ? row.finalizedAt.toISOString() : null, finalizedBy: row.finalizedBy,
  };
}

/** Real DB-backed `JobCostDraftStore`. `authorize`/`mutate` are left to the caller (a future
 * protected service entry point, same split as `src/lib/costing/service.ts`'s own `store`
 * literal) — this only supplies the read/write/source-evidence primitives. */
export function createDbJobCostDraftStore(
  authorize: () => Promise<JobCostActor>,
  jobSourceStore: JobSourceStore = createDbJobSourceStore()
): JobCostDraftStore {
  return {
    authorize,
    mutate: async (actor, operation, key, payload, work) => {
      const { runIdempotentTenantMutation } = await loadDbModule();
      return (await runIdempotentTenantMutation(
        actor.orgId,
        { operation, actorId: actor.actorId, key, payload: payload as import("@/lib/mutations").MutationJsonValue },
        work as () => Promise<import("@/lib/mutations").MutationJsonValue>
      )) as never;
    },
    buildFacts: async (params) => {
      try {
        return await buildJobCostFacts(jobSourceStore, params);
      } catch (error) {
        if (error instanceof JobSourceError) throw new JobCostStoreError(error.message, 404);
        throw error;
      }
    },
    get: async (orgId, id) => {
      const { db, schema } = await loadDbModule();
      const { jobCostSheets } = schema;
      const [row] = await db.select().from(jobCostSheets).where(and(eq(jobCostSheets.orgId, orgId), eq(jobCostSheets.id, id))).limit(1);
      return row ? dto(row) : null;
    },
    listByPlan: async (orgId, planId) => {
      const { db, schema } = await loadDbModule();
      const { jobCostSheets } = schema;
      const rows = await db.select().from(jobCostSheets).where(and(eq(jobCostSheets.orgId, orgId), eq(jobCostSheets.planId, planId)));
      return rows.map(dto);
    },
    save: async (orgId, sheet) => {
      const { db, schema } = await loadDbModule();
      const { jobCostSheets } = schema;
      const row = {
        id: sheet.id, orgId, planId: sheet.planId, productSku: sheet.productSku, revision: sheet.revision,
        version: sheet.version, status: sheet.status, calculation: sheet.calculation, supersedesId: sheet.supersedesId,
        createdAt: new Date(sheet.createdAt), createdBy: sheet.createdBy, updatedAt: new Date(sheet.updatedAt),
        finalizedAt: sheet.finalizedAt ? new Date(sheet.finalizedAt) : null, finalizedBy: sheet.finalizedBy,
      };
      if (sheet.version === 1) {
        await db.insert(jobCostSheets).values(row);
        return;
      }
      const result = await db
        .update(jobCostSheets)
        .set({ calculation: row.calculation, version: row.version, updatedAt: row.updatedAt })
        .where(and(
          eq(jobCostSheets.orgId, orgId),
          eq(jobCostSheets.id, sheet.id),
          eq(jobCostSheets.status, "Draft"),
          eq(jobCostSheets.version, sheet.version - 1)
        ))
        .returning({ id: jobCostSheets.id });
      if (!result.length) throw new JobCostStoreError("Job cost sheet is finalized or version is stale", 409);
    },
    nextId: () => generateId("JCS"),
    now: () => new Date().toISOString(),
  };
}

/**
 * MODULE-LEVEL DEVIATION NOTE for J4 to freeze before building finalize/lineage/allocation
 * logic on top of this schema:
 *
 * 1. `supersedesId` validation here only checks tenant/plan/Finalized-status; it does not
 *    (and must not) check "is the *active* lineage parent" — that requires
 *    `job_cost_lineages.activeFinalizedSheetId`, which only J4's finalize mutation writes.
 *    J3 leaves `job_cost_lineages`/`job_cost_source_allocations` completely unread/unwritten.
 * 2. Revision allocation here is `max(existing revisions for this orgId+planId) + 1`,
 *    computed from a read-then-write inside the same `runIdempotentTenantMutation`
 *    transaction (tenant-serializing by construction, mirroring
 *    `src/lib/costing/domain.ts`'s identical per-product revision allocation) — J4 must keep
 *    allocating revisions the same way when it adds the finalize path, not introduce a
 *    second incompatible counter.
 * 3. `createDbJobCostDraftStore`'s `authorize` parameter is left to the caller (a future
 *    protected HTTP service entry point, J5) — this module intentionally has no top-level
 *    `@/lib/auth/guard` or `@/lib/tenant` import, matching `source.ts`'s own
 *    production-store/pure-composition split. No route wires this store yet.
 */
