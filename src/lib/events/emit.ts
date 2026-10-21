import { and, eq, gt, inArray, or } from "drizzle-orm";
import { db } from "@/db/client";
import { domainEvents } from "@/db/schema";
import { insertRecord } from "@/db/repo";
import { generateId } from "@/lib/id";

/**
 * ===========================================================================
 * Shared "domain events" primitive — read this file's exported signatures
 * ONLY; two future features (webhook delivery, in-app notification center)
 * are built by OTHER agents against the contract documented right here, not
 * against this file's implementation. If that implementation ever changes,
 * these two exported signatures and their documented behavior MUST NOT.
 * ===========================================================================
 *
 * A domain event is a plain, append-only record of "something happened" —
 * `{ id, orgId, type, payload, createdAt }`. Nothing here retries, queues,
 * or delivers anything; this is a durable log, nothing more. Webhook
 * delivery and in-app notifications are both expected to be built as
 * separate, independent POLLERS of this log (via `listDomainEventsSince`
 * below), not as anything wired synchronously into the emit path.
 *
 * Known `type` values emitted so far (see call sites):
 *   - "order.status_changed"   payload: { orderId, fromStatus, toStatus, customerId? }
 *   - "stock.movement_recorded" payload: { sku, direction, quantity, uom, source, referenceId?, location?, userId? }
 *   - "task.assigned"          payload: { taskId, assignedTo, title } — src/lib/tasks.ts
 *     (createTask(), createRecurringOccurrence()), consumed by the in-app notification
 *     center (src/lib/notifications/dispatch.ts).
 *   - "approval.pending"       payload: { leaveId, approverId, stepNo, requesterName } —
 *     src/lib/leave/leaves.ts (createLeave()'s step-1 approver, decideLeaveStep()'s
 *     advance to the next step's approver), consumed by the same notification center.
 *
 * This primitive is intentionally type-agnostic — `emitDomainEvent()`'s signature
 * accepts any `type` string and any JSON-shaped payload. Any future event type still
 * needs no change to this file — a caller just calls `emitDomainEvent()` directly from
 * wherever the new "something happened" occurs, choosing its own payload shape and
 * documenting it in a comment at that call site (or by extending the list above).
 */

/**
 * Appends one domain event row. Fire-and-forget in the sense that there is no retry
 * queue or delivery guarantee beyond "the row is committed" — callers that need the
 * event recorded atomically with their own business writes should call this as the
 * LAST statement inside their own `runInTenantTransaction(...)` scope: this function
 * issues a plain `db.insert`, which (via `src/db/client.ts`'s tenant-transaction
 * adapter) automatically joins whatever transaction is active on the current async
 * context — it does NOT open a new transaction of its own. Called outside any active
 * transaction, the insert simply runs as its own standalone statement.
 *
 * Never throws away silently and never retries: a failed insert rejects this promise
 * exactly like any other `db.insert` failure, so a caller that awaits this inside its
 * own transaction will roll that transaction back along with it (which is the
 * intended behavior for the two call sites wired so far — see orders.ts/ledger.ts).
 *
 * @param orgId   Tenant the event belongs to.
 * @param type    Dotted event name, e.g. "order.status_changed". Free text, no enum —
 *                new types never need a migration.
 * @param payload Plain JSON-shaped data describing the event. Keep it small and
 *                self-describing; do not put secrets/PII beyond what the consumer
 *                genuinely needs (webhook payloads may leave this system).
 */
export async function emitDomainEvent(
  orgId: string,
  type: string,
  payload: Record<string, unknown>
): Promise<void> {
  if (!orgId.trim()) throw new Error("emitDomainEvent: orgId is required.");
  if (!type.trim()) throw new Error("emitDomainEvent: type is required.");
  await insertRecord(domainEvents, {
    id: generateId("EVT"),
    orgId,
    type,
    payload,
  });
}

/** One page of `listDomainEventsSince()`'s own result. */
export interface DomainEventPage {
  events: {
    id: string;
    orgId: string;
    type: string;
    payload: Record<string, unknown>;
    /** Real UTC instant (`Date`), not a string — same convention as every other
     * `timestamp({ withTimezone: true })` column in this codebase. */
    createdAt: Date;
  }[];
  /**
   * Pass this straight back in as `sinceId` to fetch the NEXT page. Equals the `id` of
   * the last event in `events` when `events` is non-empty. When `events` is EMPTY,
   * `nextSinceId` is simply the `sinceId` you passed in unchanged (there is nothing new
   * yet) — always re-use `nextSinceId` as your next `sinceId`, never re-derive a cursor
   * yourself, and polling with an unchanged cursor is the correct, expected steady state
   * once a consumer has caught up.
   */
  nextSinceId: string | null;
}

/**
 * Pages through one org's domain events in the order they were committed, strictly
 * ascending, starting just AFTER `sinceId` (or from the very beginning when `sinceId`
 * is `null`).
 *
 * PAGINATION CONTRACT — read carefully, this is the one thing both future consumers
 * (webhook delivery, notification center) depend on:
 *   - `id` values are random (`generateId("EVT")`), NOT monotonically increasing —
 *     never sort or compare by `id` alone. Ordering is by `(createdAt, id)` as a tuple
 *     (createdAt first, `id` only as a tiebreaker for events sharing one timestamp),
 *     and `sinceId` is resolved to that same `(createdAt, id)` position internally —
 *     callers only ever need to remember the opaque `id` string, never a timestamp.
 *   - Pass `null` for `sinceId` on a consumer's very first call (reads from the
 *     beginning of this org's event history). On every later call, pass the
 *     `nextSinceId` your previous call returned.
 *   - If `sinceId` doesn't correspond to any existing row (e.g. it was somehow deleted,
 *     or belongs to a different org), this throws rather than silently returning every
 *     row or no rows — a consumer must not resume from a cursor it can't actually
 *     locate.
 *   - Results never include the row identified by `sinceId` itself — strictly after it.
 *   - `limit` (default 100, max 500) bounds how many rows come back; a full page does
 *     NOT mean "there may be more" vs. an empty page meaning "caught up" — a consumer
 *     should keep calling with the returned `nextSinceId` in a loop until it gets back
 *     fewer than `limit` rows (or an empty page) before considering itself caught up
 *     for this poll cycle, exactly like any other offset/cursor pagination.
 *   - `types`, when given, restricts to those event `type` values only (e.g.
 *     `["order.status_changed"]`); omitted or empty means every type. Filtering by type
 *     does NOT change the pagination cursor semantics — `nextSinceId` still identifies a
 *     real row's `id` so a later call with a DIFFERENT `types` filter still resumes from
 *     the same point in the org's overall event stream, not from a type-filtered index.
 *
 * @param orgId   Tenant whose events to read.
 * @param sinceId Cursor from a previous call, or `null` to start from the beginning.
 * @param types   Optional allow-list of event `type` values.
 * @param limit   Max rows to return (default 100, max 500).
 */
export async function listDomainEventsSince(
  orgId: string,
  sinceId: string | null,
  types?: string[],
  limit?: number
): Promise<DomainEventPage> {
  if (!orgId.trim()) throw new Error("listDomainEventsSince: orgId is required.");
  const take = limit ?? 100;
  if (!Number.isSafeInteger(take) || take < 1 || take > 500) {
    throw new RangeError("listDomainEventsSince: limit must be an integer between 1 and 500.");
  }

  let cursorCreatedAt: Date | null = null;
  if (sinceId !== null) {
    const [cursorRow] = await db
      .select({ createdAt: domainEvents.createdAt })
      .from(domainEvents)
      .where(and(eq(domainEvents.orgId, orgId), eq(domainEvents.id, sinceId)))
      .limit(1);
    if (!cursorRow) {
      throw new Error(`listDomainEventsSince: sinceId "${sinceId}" is not a known event for this org.`);
    }
    cursorCreatedAt = cursorRow.createdAt;
  }

  const conditions = [eq(domainEvents.orgId, orgId)];
  if (cursorCreatedAt) {
    conditions.push(
      or(
        gt(domainEvents.createdAt, cursorCreatedAt),
        and(eq(domainEvents.createdAt, cursorCreatedAt), gt(domainEvents.id, sinceId as string))
      )!
    );
  }
  if (types && types.length > 0) {
    conditions.push(inArray(domainEvents.type, types));
  }

  const rows = await db
    .select()
    .from(domainEvents)
    .where(and(...conditions))
    .orderBy(domainEvents.createdAt, domainEvents.id)
    .limit(take);

  const events = rows.map((row) => ({
    id: row.id,
    orgId: row.orgId,
    type: row.type,
    payload: row.payload,
    createdAt: row.createdAt,
  }));

  return {
    events,
    nextSinceId: events.length > 0 ? events[events.length - 1]!.id : sinceId,
  };
}
