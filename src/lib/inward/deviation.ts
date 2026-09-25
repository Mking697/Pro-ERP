import { failureLog, inwardIqcFms } from "@/db/schema";
import { findById, updateById } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { findItem } from "@/lib/inventory/items";
import { recordMovement } from "@/lib/inventory/ledger";
import { getIqcDeviationApprover } from "@/lib/inward";
import { getUserById } from "@/lib/auth/users";
import { createTask } from "@/lib/tasks";
import { sendWhatsAppMessage } from "@/lib/chatxflow";

/**
 * "Accept Under Deviation" (2026-09-24) — a Failure Log entry the org decides to use anyway
 * (a documented quality concession), moved into real stock instead of sitting unresolved
 * forever. See src/db/schema/inward.ts's own comment on `failureLog.movedToInventoryAt` for
 * the idempotency reasoning, and src/lib/inventory/constants.ts's own comment on the
 * `"IQC_Deviation"` ledger source for why this is kept distinct from a normal `"IQC"` pass.
 *
 * A two-step request/approval flow, not a single click — mirrors src/lib/orders/orders.ts's
 * Credit_Hold gate exactly: `requestUnderDeviation()` (any IQC_CHECK holder) only flags the
 * entry as wanted; stock only actually moves once `approveUnderDeviation()` runs, which is
 * gated to the org's configured Deviation Approver (src/lib/inward.ts's
 * getIqcDeviationApprover(), set on the same "Inward IQC" admin settings screen the TAT
 * fields live on) or an Admin — same authorization shape as approveCreditHold(). Rejecting
 * just clears the request back to un-requested (`rejectUnderDeviation()`) so it can be
 * re-requested later; failure_log carries no separate audit trail for this, same as before.
 *
 * Independent of Debit Notes (src/lib/accounts/debitNotes.ts) — an entry can get either,
 * both, or neither. This file only ever moves stock; it never touches `debitNoteId`.
 */

export class DeviationError extends Error {}

/** Best-effort Task + WhatsApp to the configured Deviation Approver — mirrors
 * src/lib/orders/orders.ts's notifyShortage() fan-out shape exactly, simplified to one
 * recipient (there is only ever one approver, not a list of grant holders). Never throws;
 * a missing setting, a missing phone, or a failed send is logged and swallowed. */
async function notifyDeviationApprover(
  orgId: string,
  failureLogId: string,
  partyName: string,
  invoiceNo: string,
  failQty: string
): Promise<void> {
  const approverId = await getIqcDeviationApprover();
  if (!approverId) {
    console.error(`[deviation] no Deviation Approver configured — skipping notify for ${failureLogId}`);
    return;
  }

  const approver = await getUserById(approverId);
  if (!approver) {
    console.error(`[deviation] configured Deviation Approver ${approverId} not found — skipping notify for ${failureLogId}`);
    return;
  }

  const message = `Namaste ${approver.Full_Name}, ek IQC fail quantity "Under Deviation" accept karne ke liye request hui hai — ${partyName} / ${invoiceNo}, Qty ${failQty}. Approve/Reject karne ke liye Inward > Failure Log kholein.`;

  try {
    await createTask({
      title: `IQC Deviation approval — ${partyName}`,
      description: message,
      assignedTo: approver.User_ID,
      assignedBy: "SYSTEM",
      priority: "High",
      dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      attachmentUrl: "",
      remark: "",
    });
  } catch (error) {
    console.error(`[deviation] approval task creation failed for ${failureLogId}:`, error);
  }

  try {
    const result = await sendWhatsAppMessage(approver.Phone_Number, message);
    if (!result.ok) {
      console.error(`[deviation] approval WhatsApp send failed for ${failureLogId}: ${result.error}`);
    }
  } catch (error) {
    console.error(`[deviation] approval WhatsApp send threw for ${failureLogId}:`, error);
  }
}

/** Step 1 — an IQC_CHECK holder marks a failed quantity as wanted under deviation. Does NOT
 * move stock; only the subsequent approveUnderDeviation() does that. Best-effort notifies
 * the configured approver. */
export async function requestUnderDeviation(failureLogId: string, actorId: string): Promise<void> {
  const orgId = await getTenantOrgId();

  const failureRow = await findById(failureLog, orgId, failureLogId);
  if (!failureRow) throw new DeviationError("Failure Log entry nahi mila.");
  if (failureRow.movedToInventoryAt) {
    throw new DeviationError("Ye entry pehle hi Under Deviation accept ho chuki hai.");
  }
  if (failureRow.deviationRequestedAt) {
    throw new DeviationError("Is entry ke liye pehle hi Under Deviation request ho chuki hai — approval ka wait karein.");
  }

  const updated = await updateById(failureLog, orgId, failureLogId, {
    deviationRequestedAt: new Date(),
    deviationRequestedBy: actorId,
  });
  if (!updated) throw new DeviationError("Request save nahi ho payi.");

  try {
    await notifyDeviationApprover(orgId, failureLogId, failureRow.partyName, failureRow.invoiceNo, failureRow.failQty);
  } catch (error) {
    console.error(`[deviation] notifyDeviationApprover failed for ${failureLogId}:`, error);
  }
}

/** Step 2a — the configured Deviation Approver (or an Admin) approves a Requested entry.
 * This is the point stock actually moves — unlike the notify above, the stock write is NOT
 * best-effort: it is the entire point of this action, so a bad SKU or insufficient stock
 * must throw and leave the entry in "Requested", not silently no-op. */
export async function approveUnderDeviation(
  failureLogId: string,
  actor: { userId: string; role: string }
): Promise<void> {
  const orgId = await getTenantOrgId();

  const failureRow = await findById(failureLog, orgId, failureLogId);
  if (!failureRow) throw new DeviationError("Failure Log entry nahi mila.");
  if (failureRow.movedToInventoryAt) {
    throw new DeviationError("Ye entry pehle hi Under Deviation accept ho chuki hai.");
  }
  if (!failureRow.deviationRequestedAt) {
    throw new DeviationError("Is entry ke liye abhi koi Under Deviation request nahi hai.");
  }

  const approverId = await getIqcDeviationApprover();
  const authorized = actor.role === "Admin" || (Boolean(approverId) && actor.userId === approverId);
  if (!authorized) {
    throw new DeviationError("Sirf configured Deviation Approver (ya Admin) hi ise approve kar sakta hai.");
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
    userId: actor.userId,
  });

  const updated = await updateById(failureLog, orgId, failureLogId, {
    movedToInventoryAt: new Date(),
    deviationApprovedBy: actor.userId,
    deviationApprovedAt: new Date(),
  });
  if (!updated) throw new DeviationError("Stock add ho gaya lekin Failure Log update nahi ho paya.");
}

/** Step 2b — the configured Deviation Approver (or an Admin) rejects a Requested entry,
 * clearing it back to the un-requested state so it can be requested again later. No
 * separate audit trail — failure_log has none today, don't add one for just this. */
export async function rejectUnderDeviation(
  failureLogId: string,
  actor: { userId: string; role: string }
): Promise<void> {
  const orgId = await getTenantOrgId();

  const failureRow = await findById(failureLog, orgId, failureLogId);
  if (!failureRow) throw new DeviationError("Failure Log entry nahi mila.");
  if (failureRow.movedToInventoryAt) {
    throw new DeviationError("Ye entry pehle hi Under Deviation accept ho chuki hai.");
  }
  if (!failureRow.deviationRequestedAt) {
    throw new DeviationError("Is entry ke liye abhi koi Under Deviation request nahi hai.");
  }

  const approverId = await getIqcDeviationApprover();
  const authorized = actor.role === "Admin" || (Boolean(approverId) && actor.userId === approverId);
  if (!authorized) {
    throw new DeviationError("Sirf configured Deviation Approver (ya Admin) hi ise reject kar sakta hai.");
  }

  const updated = await updateById(failureLog, orgId, failureLogId, {
    deviationRequestedAt: null,
    deviationRequestedBy: "",
  });
  if (!updated) throw new DeviationError("Reject nahi ho paya.");
}
