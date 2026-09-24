import { failureLog, inwardIqcFms } from "@/db/schema";
import { findById, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { findItem } from "@/lib/inventory/items";
import { recordMovement } from "@/lib/inventory/ledger";

/**
 * "Accept Under Deviation" (2026-09-24) — a Failure Log entry the org decides to use anyway
 * (a documented quality concession), moved into real stock instead of sitting unresolved
 * forever. See src/db/schema/inward.ts's own comment on `failureLog.movedToInventoryAt` for
 * the idempotency reasoning, and src/lib/inventory/constants.ts's own comment on the
 * `"IQC_Deviation"` ledger source for why this is kept distinct from a normal `"IQC"` pass.
 *
 * Independent of Debit Notes (src/lib/accounts/debitNotes.ts) — an entry can get either,
 * both, or neither. This file only ever moves stock; it never touches `debitNoteId`.
 */

export class DeviationError extends Error {}

/**
 * Unlike `submitQualityCheck()`'s own passed-quantity stock write (best-effort, since a
 * completed quality check is already saved and must not be undone by a failed stock write),
 * this action's ENTIRE point is the stock write — there is no other document being
 * protected here. If `recordMovement()` throws, it is let through rather than swallowed, so
 * the entry stays un-accepted and the Doer sees the real error instead of a silent no-op.
 */
export async function acceptUnderDeviation(failureLogId: string, actorId: string): Promise<void> {
  const orgId = await getTenantOrgId();

  const failureRow = await findById(failureLog, orgId, failureLogId);
  if (!failureRow) throw new DeviationError("Failure Log entry nahi mila.");
  if (failureRow.movedToInventoryAt) {
    throw new DeviationError("Ye entry pehle hi Under Deviation accept ho chuki hai.");
  }

  const inwardRow = await findById(inwardIqcFms, orgId, failureRow.linkedEntryId);
  if (!inwardRow) throw new DeviationError("Is failure ka linked Inward entry nahi mila.");
  const sku = inwardRow.sku.trim();
  if (!sku) {
    throw new DeviationError("Is entry me koi Item (SKU) link nahi hai — stock me add nahi ho sakta.");
  }

  const item = await findItem(sku);
  if (!item) throw new DeviationError(`SKU "${sku}" Items master me nahi hai.`);

  const failQty = Number(failureRow.failQty) || 0;
  if (!(failQty > 0)) throw new DeviationError("Is entry ki Fail Qty 0 hai — stock me kuch add nahi karna.");

  await recordMovement({
    sku,
    direction: "In",
    quantity: failQty,
    uom: item.UOM,
    source: "IQC_Deviation",
    referenceId: failureLogId,
    location: item.Location,
    remark: `IQC fail accepted under deviation — ${failureRow.partyName} / ${failureRow.invoiceNo}`,
    userId: actorId,
  });

  const updated = await updateById(failureLog, orgId, failureLogId, { movedToInventoryAt: new Date() });
  if (!updated) throw new DeviationError("Stock add ho gaya lekin Failure Log update nahi ho paya.");
}
