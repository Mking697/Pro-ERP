/**
 * J4 — finalize transaction, active lineage pointer and General-PO-line source-allocation
 * cap enforcement for Recorded Job Cost Sheets.
 *
 * Deliberately a SIBLING module, not an edit to `./store.ts` (frozen per the J3 completion
 * note) — this file only imports `JobCostStoreError`/`JobCostActor`/`JobCostFactsParams`
 * from `store.ts`, it does not modify that file at all. Mirrors the same pure-domain /
 * real-wiring split as `store.ts` and `src/lib/costing/domain.ts` + `service.ts`.
 *
 * Contract (docs/job-cost-sheet-implementation.md sections 3/5/6, J3 completion note):
 *  - Re-validate the Draft's saved calculation by rebuilding facts through the J2 adapter
 *    and recomputing through the J1 engine inside the transaction; compare
 *    `sourceFingerprint`. A mismatch is a 409 "changed evidence" error — never a silent
 *    reprice. Only once the fingerprint matches (so the fresh calculation is, by
 *    determinism, identical to the stored one) do we trust `sourceComplete`/
 *    `valuationComplete`/`canFinalize`.
 *  - First finalize for a plan: mark the sheet Finalized, insert one source-allocation row
 *    per cost-bearing (DirectExpense/FactoryOverhead/Commercial) General PO line decision,
 *    and create the plan's `job_cost_lineages` row pointing at this sheet.
 *  - Successor finalize (`supersedesId` set): validate it equals the current active lineage
 *    pointer, deactivate the parent's allocation rows, insert the successor's new rows and
 *    advance the pointer — all inside the same mutation transaction.
 *  - Per-General-PO-line cap: sum of every currently ACTIVE allocation referencing that
 *    line (across any sheet, excluding only an explicitly superseded parent's own rows)
 *    plus this sheet's requested allocation must not exceed `min(receivedQty*rate,
 *    orderedAmount)` in cents. Exceeding blocks the WHOLE finalize — never a partial/
 *    clamped allocation. Duplicate allocation of the same source line twice within one
 *    sheet is rejected defensively (structurally prevented upstream by
 *    `jobCostInputSchema`/`jobCostFactsSchema` uniqueness refinements, but re-checked here
 *    too since this module must never blindly trust a stored calculation's shape).
 *  - Concurrency: exactly one of two racing finalizes against the same plan lineage
 *    pointer wins. The production store's `createLineage` is a real
 *    `INSERT ... ON CONFLICT DO NOTHING` (unique `(orgId, planId)` index) and
 *    `advanceLineage` is a real conditional `UPDATE ... WHERE active_finalized_sheet_id =
 *    $from` (row-level lock, re-evaluated predicate) — the same compare-and-swap shape as
 *    `store.ts`'s own optimistic-version `save()` update. Both return a boolean instead of
 *    throwing so this module decides the resulting domain error itself.
 */
import { z } from "zod";
import { generateId } from "@/lib/id";
import { calculateJobCost } from "./engine";
import { JobCostStoreError, type JobCostActor, type JobCostFactsParams } from "./store";
import type { JobCostCalculation, JobCostFacts, JobCostInput, JobCostSheet } from "./types";

const idText = z.string().min(1).max(200);
const finalizeSchema = z
  .object({
    expectedVersion: z.number().int().min(1).max(2147483646),
    sourceFingerprint: z.string().min(1).max(200),
  })
  .strict();

const COST_BEARING_HEADS = new Set(["DirectExpense", "FactoryOverhead", "Commercial"]);

export type JobCostSourceKind = "GeneralPOLine";

/** Persisted shape of one `job_cost_source_allocations` row (see `src/db/schema/jobCosting.ts`). */
export interface JobCostAllocationRecord {
  id: string;
  sheetId: string;
  sourceKind: JobCostSourceKind;
  sourceId: string;
  poId: string;
  planId: string;
  head: string;
  allocatedAmount: string;
  eligibleCap: string;
  sourceFingerprint: string;
  facts: unknown;
  basis: string;
  reason: string;
  approvedBy: string;
  approvedAt: string;
  active: boolean;
}

export interface JobCostLineagePointer {
  activeFinalizedSheetId: string | null;
  version: number;
}

/** Everything the finalize domain needs from persistence/source evidence. Every write is
 * expected to execute inside the SAME mutation transaction (see `createJobCostFinalizeDomain`'s
 * `mutate` call) — this interface does not open its own transactions. */
export interface JobCostFinalizeStore {
  authorize(): Promise<JobCostActor>;
  mutate<T>(actor: JobCostActor, operation: string, key: string, payload: unknown, work: () => Promise<T>): Promise<T>;
  buildFacts(params: JobCostFactsParams): Promise<JobCostFacts>;
  /** Pure recompute hook — the production store always wires this straight to
   * `calculateJobCost` (see `createDbJobCostFinalizeStore`), never a second/divergent
   * engine. Exposed as an injectable store method (not a hardcoded call) purely so tests
   * can exercise this module's OWN defensive guards (e.g. the duplicate-source-line check)
   * against a crafted calculation shape that the real engine's zod schemas already make
   * structurally unreachable — i.e. defense in depth, not a second source of truth. */
  recompute(input: JobCostInput, facts: JobCostFacts): JobCostCalculation;
  getSheet(orgId: string, id: string): Promise<JobCostSheet | null>;
  /** Draft -> Finalized CAS, mirroring `store.ts`'s own `save()` update branch exactly:
   * succeeds only if the row is still `Draft` at `expectedVersion`; otherwise throws 409. */
  finalizeSheetRow(orgId: string, sheet: JobCostSheet, expectedVersion: number): Promise<void>;
  nextAllocationId(): string;
  now(): string;
  getLineage(orgId: string, planId: string): Promise<JobCostLineagePointer | null>;
  /** First finalize for a plan. `true` on success; `false` if a concurrent finalize already
   * created the row first (real store: `INSERT ... ON CONFLICT (orgId, planId) DO NOTHING`). */
  createLineage(orgId: string, planId: string, sheetId: string): Promise<boolean>;
  /** Successor finalize. `true` on success; `false` if the pointer no longer equals
   * `fromSheetId` (real store: conditional `UPDATE ... WHERE active_finalized_sheet_id = $from`). */
  advanceLineage(orgId: string, planId: string, fromSheetId: string, toSheetId: string): Promise<boolean>;
  /** Every currently ACTIVE allocation row for any of these source ids, across any sheet. */
  listActiveAllocations(orgId: string, sourceIds: string[]): Promise<JobCostAllocationRecord[]>;
  insertAllocations(orgId: string, rows: JobCostAllocationRecord[]): Promise<void>;
  deactivateAllocations(orgId: string, sheetId: string): Promise<void>;
}

export interface JobCostFinalizeService {
  finalize(id: string, raw: unknown, key: string): Promise<JobCostSheet>;
}

/** Parses a `money()`-formatted (`costing/validation.ts`) nonnegative decimal string with
 * exactly two fractional digits into integer cents. Never a float operation. */
function centsOf(value: string): bigint {
  const match = /^(\d+)\.(\d{2})$/.exec(value);
  if (!match) throw new JobCostStoreError(`Invalid money amount: ${value}`, 500);
  return BigInt(match[1]) * BigInt(100) + BigInt(match[2]);
}

/** Pure domain logic over the injected store — DB-free, directly unit-testable with a
 * fixture store (see `tests/job-costing-finalize.test.ts`), mirroring `store.ts`'s own
 * `createJobCostDraftDomain` split. */
export function createJobCostFinalizeDomain(store: JobCostFinalizeStore): JobCostFinalizeService {
  async function mutation<T>(op: string, key: string, payload: unknown, work: (actor: JobCostActor) => Promise<T>): Promise<T> {
    if (!key) throw new JobCostStoreError("Idempotency-Key is required");
    const actor = await store.authorize();
    return store.mutate(actor, "job-costing.v1." + op, key, payload, async () => {
      // Re-authorize inside the mutation's transaction boundary, same discipline as
      // `store.ts`'s drafts — a revoked grant between entry and transaction admission
      // must not let stale work commit.
      const live = await store.authorize();
      if (live.orgId !== actor.orgId || live.actorId !== actor.actorId) throw new JobCostStoreError("Forbidden", 403);
      return work(live);
    });
  }

  return {
    async finalize(id: string, raw: unknown, key: string): Promise<JobCostSheet> {
      idText.parse(id);
      const payload = finalizeSchema.parse(raw);
      return mutation("finalize", key, { id, ...payload }, async (actor) => {
        const sheet = await store.getSheet(actor.orgId, id);
        if (!sheet) throw new JobCostStoreError("Job cost sheet not found", 404);
        if (sheet.status !== "Draft" || sheet.version !== payload.expectedVersion) {
          throw new JobCostStoreError("Job cost sheet is finalized or version is stale; reload", 409);
        }
        if (sheet.calculation.sourceFingerprint !== payload.sourceFingerprint) {
          throw new JobCostStoreError("Submitted source fingerprint does not match the saved Draft; reload", 409);
        }

        // Re-check current evidence inside the transaction. Never trust the saved
        // calculation's flags until a freshly rebuilt/recomputed fingerprint proves
        // nothing has changed since the Draft was saved.
        const freshFacts = await store.buildFacts({
          orgId: actor.orgId,
          planId: sheet.planId,
          asOfDate: sheet.calculation.input.asOfDate,
          capturedBy: actor.actorId,
        });
        let freshCalc: JobCostCalculation;
        try {
          freshCalc = store.recompute(sheet.calculation.input, freshFacts);
        } catch (error) {
          throw new JobCostStoreError(
            `Current source evidence can no longer be recomputed for this plan: ${error instanceof Error ? error.message : String(error)}`,
            409
          );
        }
        if (freshCalc.sourceFingerprint !== sheet.calculation.sourceFingerprint) {
          throw new JobCostStoreError("Source evidence has changed since this Draft was saved; recalculate before finalizing", 409);
        }
        if (!freshCalc.sourceComplete || !freshCalc.valuationComplete || !freshCalc.canFinalize) {
          throw new JobCostStoreError("Draft is not finalizable: sourceComplete/valuationComplete/canFinalize are not all true", 409);
        }

        // Collect cost-bearing General PO line claims. Defensive duplicate-source-line
        // guard: structurally unreachable through the real engine (both
        // `jobCostInputSchema` and `jobCostFactsSchema` reject duplicate lineIds), but
        // this module must never blindly trust a stored calculation's shape either.
        const seenLineIds = new Set<string>();
        const claims: { lineId: string; poId: string; head: string; allocatedAmount: string; eligibleCap: string }[] = [];
        for (const line of freshCalc.generalSources) {
          if (!line.decision || !COST_BEARING_HEADS.has(line.decision.classification)) continue;
          if (seenLineIds.has(line.lineId)) {
            throw new JobCostStoreError(`Duplicate allocation for source line ${line.lineId} within one sheet`, 400);
          }
          seenLineIds.add(line.lineId);
          if (line.allocatedAmount === null || line.eligibleCap === null) {
            throw new JobCostStoreError(`General PO line ${line.lineId} has no resolved allocation amount; cannot finalize`, 409);
          }
          claims.push({
            lineId: line.lineId,
            poId: line.poId,
            head: line.decision.classification,
            allocatedAmount: line.allocatedAmount,
            eligibleCap: line.eligibleCap,
          });
        }

        // Successor vs. first-finalize branching against the plan's active lineage pointer.
        const lineage = await store.getLineage(actor.orgId, sheet.planId);
        if (sheet.supersedesId) {
          if (!lineage || lineage.activeFinalizedSheetId !== sheet.supersedesId) {
            throw new JobCostStoreError("supersedesId no longer matches the active finalized lineage pointer; reload", 409);
          }
        } else if (lineage && lineage.activeFinalizedSheetId !== null) {
          throw new JobCostStoreError("This plan already has an active finalized sheet; supersede it explicitly", 409);
        }

        // Cap arithmetic over REAL active allocations (never the Draft-time facts' fixed
        // `activeAllocatedAmount = "0.00"` placeholder — see `source.ts`'s module-level
        // deviation note). Exclude only the explicitly superseded parent's own rows, which
        // are deactivated in this same transaction.
        if (claims.length > 0) {
          const activeRows = await store.listActiveAllocations(actor.orgId, claims.map((c) => c.lineId));
          const activeByLine = new Map<string, bigint>();
          for (const row of activeRows) {
            if (sheet.supersedesId && row.sheetId === sheet.supersedesId) continue;
            activeByLine.set(row.sourceId, (activeByLine.get(row.sourceId) ?? BigInt(0)) + centsOf(row.allocatedAmount));
          }
          for (const claim of claims) {
            const existing = activeByLine.get(claim.lineId) ?? BigInt(0);
            const requested = centsOf(claim.allocatedAmount);
            const cap = centsOf(claim.eligibleCap);
            if (existing + requested > cap) {
              throw new JobCostStoreError(
                `Allocation for General PO line ${claim.lineId} (${requested} cents) plus other active allocations (${existing} cents) would exceed its eligible cap (${cap} cents)`,
                409
              );
            }
          }
        }

        // Lineage pointer CAS decides the race first — no sheet/allocation writes happen
        // unless this succeeds, so a losing concurrent finalize leaves nothing behind.
        if (sheet.supersedesId) {
          const advanced = await store.advanceLineage(actor.orgId, sheet.planId, sheet.supersedesId, sheet.id);
          if (!advanced) throw new JobCostStoreError("Concurrent finalize already advanced this plan's lineage; reload", 409);
        } else {
          const created = await store.createLineage(actor.orgId, sheet.planId, sheet.id);
          if (!created) throw new JobCostStoreError("Concurrent finalize already created this plan's active lineage; reload", 409);
        }

        const now = store.now();
        const finalizedSheet: JobCostSheet = {
          ...sheet,
          status: "Finalized",
          version: sheet.version + 1,
          updatedAt: now,
          finalizedAt: now,
          finalizedBy: actor.actorId,
          calculation: freshCalc,
        };
        await store.finalizeSheetRow(actor.orgId, finalizedSheet, sheet.version);

        if (claims.length > 0) {
          const allocationRows: JobCostAllocationRecord[] = claims.map((c) => ({
            id: store.nextAllocationId(),
            sheetId: sheet.id,
            sourceKind: "GeneralPOLine",
            sourceId: c.lineId,
            poId: c.poId,
            planId: sheet.planId,
            head: c.head,
            allocatedAmount: c.allocatedAmount,
            eligibleCap: c.eligibleCap,
            sourceFingerprint: freshCalc.sourceFingerprint,
            facts: { lineId: c.lineId, poId: c.poId, planId: sheet.planId },
            basis: "GeneralPOLineReceipt",
            reason: `Finalized job cost sheet ${sheet.id} (revision ${sheet.revision})`,
            approvedBy: actor.actorId,
            approvedAt: now,
            active: true,
          }));
          await store.insertAllocations(actor.orgId, allocationRows);
        }

        if (sheet.supersedesId) {
          await store.deactivateAllocations(actor.orgId, sheet.supersedesId);
        }

        return finalizedSheet;
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Production store — real schema reads/writes only, tenant-scoped by construction. Not
// exercised by the DB-free test suite; wiring is covered by the typecheck/lint gates only,
// same convention as `store.ts`'s own `createDbJobCostDraftStore`.
// ---------------------------------------------------------------------------

let dbModulePromise: Promise<{
  db: typeof import("@/db/client").db;
  schema: typeof import("@/db/schema");
  runIdempotentTenantMutation: typeof import("@/lib/mutations").runIdempotentTenantMutation;
}> | null = null;
async function loadDbModule() {
  if (!dbModulePromise) {
    dbModulePromise = Promise.all([
      import("@/db/client"),
      import("@/db/schema"),
      import("@/lib/mutations"),
    ]).then(([client, schema, mutations]) => ({
      db: client.db,
      schema,
      runIdempotentTenantMutation: mutations.runIdempotentTenantMutation,
    }));
  }
  return dbModulePromise;
}

function sheetDto(row: {
  id: string; planId: string; productSku: string; revision: number; version: number;
  status: "Draft" | "Finalized"; calculation: JobCostCalculation; supersedesId: string | null;
  createdAt: Date; createdBy: string; updatedAt: Date; finalizedAt: Date | null; finalizedBy: string | null;
}): JobCostSheet {
  return {
    id: row.id, planId: row.planId, productSku: row.productSku, revision: row.revision, version: row.version,
    status: row.status, supersedesId: row.supersedesId, calculation: row.calculation,
    createdBy: row.createdBy, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    finalizedAt: row.finalizedAt ? row.finalizedAt.toISOString() : null, finalizedBy: row.finalizedBy,
  };
}

/** Real DB-backed `JobCostFinalizeStore`. `authorize`/`mutate` are left to the caller (a
 * future protected service entry point, J5), same split as `store.ts`'s own production store. */
export function createDbJobCostFinalizeStore(
  authorize: () => Promise<JobCostActor>,
  buildFacts: (params: JobCostFactsParams) => Promise<JobCostFacts>
): JobCostFinalizeStore {
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
    buildFacts,
    // Always the real, unmodified J1 engine — see the interface-level comment above.
    recompute: calculateJobCost,
    getSheet: async (orgId, id) => {
      const { db, schema } = await loadDbModule();
      const { jobCostSheets } = schema;
      const { and, eq } = await import("drizzle-orm");
      const [row] = await db.select().from(jobCostSheets).where(and(eq(jobCostSheets.orgId, orgId), eq(jobCostSheets.id, id))).limit(1);
      return row ? sheetDto(row) : null;
    },
    finalizeSheetRow: async (orgId, sheet, expectedVersion) => {
      const { db, schema } = await loadDbModule();
      const { jobCostSheets } = schema;
      const { and, eq } = await import("drizzle-orm");
      const result = await db
        .update(jobCostSheets)
        .set({
          status: "Finalized",
          calculation: sheet.calculation,
          version: sheet.version,
          updatedAt: new Date(sheet.updatedAt),
          finalizedAt: new Date(sheet.finalizedAt!),
          finalizedBy: sheet.finalizedBy,
        })
        .where(and(
          eq(jobCostSheets.orgId, orgId),
          eq(jobCostSheets.id, sheet.id),
          eq(jobCostSheets.status, "Draft"),
          eq(jobCostSheets.version, expectedVersion)
        ))
        .returning({ id: jobCostSheets.id });
      if (!result.length) throw new JobCostStoreError("Job cost sheet is finalized or version is stale", 409);
    },
    nextAllocationId: () => generateId("JCA"),
    now: () => new Date().toISOString(),
    getLineage: async (orgId, planId) => {
      const { db, schema } = await loadDbModule();
      const { jobCostLineages } = schema;
      const { and, eq } = await import("drizzle-orm");
      const [row] = await db.select().from(jobCostLineages).where(and(eq(jobCostLineages.orgId, orgId), eq(jobCostLineages.planId, planId))).limit(1);
      return row ? { activeFinalizedSheetId: row.activeFinalizedSheetId, version: row.version } : null;
    },
    createLineage: async (orgId, planId, sheetId) => {
      const { db, schema } = await loadDbModule();
      const { jobCostLineages } = schema;
      const result = await db
        .insert(jobCostLineages)
        .values({ orgId, planId, activeFinalizedSheetId: sheetId, version: 1 })
        .onConflictDoNothing({ target: [jobCostLineages.orgId, jobCostLineages.planId] })
        .returning({ orgId: jobCostLineages.orgId });
      return result.length > 0;
    },
    advanceLineage: async (orgId, planId, fromSheetId, toSheetId) => {
      const { db, schema } = await loadDbModule();
      const { jobCostLineages } = schema;
      const { and, eq, sql } = await import("drizzle-orm");
      const result = await db
        .update(jobCostLineages)
        .set({ activeFinalizedSheetId: toSheetId, version: sql`${jobCostLineages.version} + 1` })
        .where(and(
          eq(jobCostLineages.orgId, orgId),
          eq(jobCostLineages.planId, planId),
          eq(jobCostLineages.activeFinalizedSheetId, fromSheetId)
        ))
        .returning({ orgId: jobCostLineages.orgId });
      return result.length > 0;
    },
    listActiveAllocations: async (orgId, sourceIds) => {
      const { db, schema } = await loadDbModule();
      const { jobCostSourceAllocations } = schema;
      const { and, eq, inArray } = await import("drizzle-orm");
      if (!sourceIds.length) return [];
      const rows = await db
        .select()
        .from(jobCostSourceAllocations)
        .where(and(
          eq(jobCostSourceAllocations.orgId, orgId),
          eq(jobCostSourceAllocations.sourceKind, "GeneralPOLine"),
          inArray(jobCostSourceAllocations.sourceId, sourceIds),
          eq(jobCostSourceAllocations.active, true)
        ));
      return rows.map((r) => ({
        id: r.id, sheetId: r.sheetId, sourceKind: "GeneralPOLine", sourceId: r.sourceId, poId: r.poId, planId: r.planId,
        head: r.head, allocatedAmount: r.allocatedAmount, eligibleCap: r.eligibleCap, sourceFingerprint: r.sourceFingerprint,
        facts: r.facts, basis: r.basis, reason: r.reason, approvedBy: r.approvedBy, approvedAt: r.approvedAt.toISOString(), active: r.active,
      }));
    },
    insertAllocations: async (orgId, rows) => {
      const { db, schema } = await loadDbModule();
      const { jobCostSourceAllocations } = schema;
      await db.insert(jobCostSourceAllocations).values(
        rows.map((r) => ({
          id: r.id, orgId, sheetId: r.sheetId, sourceKind: r.sourceKind, sourceId: r.sourceId, poId: r.poId, planId: r.planId,
          head: r.head, allocatedAmount: r.allocatedAmount, eligibleCap: r.eligibleCap, sourceFingerprint: r.sourceFingerprint,
          facts: r.facts, basis: r.basis, reason: r.reason, approvedBy: r.approvedBy, approvedAt: new Date(r.approvedAt), active: r.active,
        }))
      );
    },
    deactivateAllocations: async (orgId, sheetId) => {
      const { db, schema } = await loadDbModule();
      const { jobCostSourceAllocations } = schema;
      const { and, eq } = await import("drizzle-orm");
      await db
        .update(jobCostSourceAllocations)
        .set({ active: false })
        .where(and(
          eq(jobCostSourceAllocations.orgId, orgId),
          eq(jobCostSourceAllocations.sheetId, sheetId),
          eq(jobCostSourceAllocations.active, true)
        ));
    },
  };
}

/**
 * MODULE-LEVEL DEVIATION NOTE / open decisions for J5 (HTTP routes/UI) to freeze:
 *
 * 1. `buildFacts` is accepted as a parameter (not constructed internally with a default
 *    `createDbJobSourceStore()` the way `store.ts`'s `createDbJobCostDraftStore` does) so
 *    J5 can pass the exact same bound adapter instance used for preview/Draft recalculation
 *    without this module importing `./source` directly — purely a wiring convenience, no
 *    behavior difference from `store.ts`'s pattern.
 * 2. `JobCostSourceAllocation.facts` is stored as a small `{lineId, poId, planId}` pointer,
 *    not the full `JobGeneralSourceFact` evidence row — the authoritative evidence snapshot
 *    already lives inside `job_cost_sheets.calculation.generalSources` for both this sheet
 *    and (immutably) every prior finalized sheet. J5/reporting should read the sheet
 *    snapshot for full evidence, using the allocation row only to know which sheet/head/
 *    amount is the currently active claim on a given PO line. If a future stage needs a
 *    fuller allocation-row fact snapshot, extending this field is additive (JSONB, no
 *    migration) but must stay backward-compatible with already-inserted rows.
 * 3. Lineage-pointer-first write ordering (CAS before the sheet row / allocation inserts)
 *    is deliberate: it makes the DB-free fixture test's rollback story exact (a losing
 *    concurrent finalize writes nothing at all, not just "nothing durable"), and is
 *    equivalent inside a real Postgres transaction since every write here commits or rolls
 *    back together regardless of order. Do not reorder this without re-reading the J4 test
 *    file's race-simulation assertions.
 */
