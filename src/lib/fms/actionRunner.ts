import { findItem } from "@/lib/inventory/items";
import { listLedger, onHandBySku, recordMovement } from "@/lib/inventory/ledger";
import { committedBySku } from "@/lib/inventory/plans";
// round3 lives with the allocation, which imports nothing at all — see ledger.ts's own
// import of it for the same reason.
import { round3 } from "@/lib/inventory/allocation";
import type { LedgerMovementActionConfig } from "@/lib/fms/actions";

/**
 * Runs a step's configured Action for the outcome it was just completed with.
 *
 * Unlike the best-effort FMS event chaining (emitFmsEvent), this is not best-effort: the
 * ledger write here is the whole point of the step, so a failure (bad SKU, insufficient
 * stock, a missing field) must throw and leave the step Pending — never silently skipped,
 * and never allowed to complete without the movement it promised.
 */
export async function runLedgerMovementAction(
  config: LedgerMovementActionConfig,
  outcome: string,
  resolvedFields: Record<string, string>,
  runId: string,
  userId: string
): Promise<void> {
  const action = config[outcome];
  if (!action) return;

  const sku = resolvedFields[action.skuField]?.trim();
  if (!sku) {
    throw new Error(`Action ke liye SKU nahi mila (field "${action.skuField}" khaali hai).`);
  }

  const quantity = Number(resolvedFields[action.qtyField]?.trim());
  if (!(quantity > 0)) {
    throw new Error(`Action ke liye valid quantity nahi mili (field "${action.qtyField}").`);
  }

  const item = await findItem(sku);
  if (!item) {
    throw new Error(
      `SKU "${sku}" Items master me nahi hai — pehle ise ek item (Category: FG ya Semi-FG) ke roop me add karein, phir ye step complete karein.`
    );
  }

  const uom = (action.uomField ? resolvedFields[action.uomField]?.trim() : "") || item.UOM;

  let available: number | undefined;
  if (action.direction === "Out") {
    const [ledger, committed] = await Promise.all([listLedger(), committedBySku()]);
    const onHand = onHandBySku(ledger);
    available = round3((onHand.get(sku) ?? 0) - (committed.get(sku) ?? 0));
  }

  await recordMovement(
    {
      sku,
      direction: action.direction,
      quantity,
      uom,
      source: "FMS",
      referenceId: runId,
      location: item.Location,
      remark: `FMS action — outcome "${outcome}"`,
      userId,
    },
    available
  );
}
