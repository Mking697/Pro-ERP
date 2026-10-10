import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { findItem } from "@/lib/inventory/items";
import {
  recordMovement,
  InsufficientStockError,
  DIRECTIONS,
} from "@/lib/inventory/ledger";
import { getMutationKey, runIdempotentTenantMutation, MutationConflictError } from "@/lib/mutations";
import { getTenantOrgId } from "@/lib/tenant";
import { InsufficientAvailableStockError } from "@/lib/inventory/availability";

const bodySchema = z.object({
  sku: z.string().trim().min(1, "SKU zaroori hai."),
  direction: z.enum(DIRECTIONS),
  quantity: z.coerce.number().positive("Quantity 0 se zyada honi chahiye."),
  location: z.string().trim().optional().default(""),
  issuedTo: z.string().trim().optional().default(""),
  remark: z.string().trim().optional().default(""),
});

export async function POST(request: Request) {
  const guard = await requireModule("INVENTORY_TXN");
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  const { sku, direction, quantity, location, issuedTo, remark } = parsed.data;

  // The UOM comes from the item, never from the caller — a movement recorded in a
  // different unit than the item is measured in would corrupt every later total.
  const item = await findItem(sku);
  if (!item) {
    return NextResponse.json({ error: `SKU "${sku}" nahi mila.` }, { status: 400 });
  }

  try {
    const orgId = await getTenantOrgId();
    const movement = await runIdempotentTenantMutation(orgId, {
      operation: "inventory.movement.manual.v1", actorId: guard.session.userId,
      key: getMutationKey(request), payload: { sku, direction, quantity, location, issuedTo, remark },
    }, async () => ({ ...await recordMovement({
      sku, direction, quantity, uom: item.UOM, source: "Manual",
      location: location || item.Location, issuedTo, remark, userId: guard.session.userId,
    }) }));

    return NextResponse.json({ movement });
  } catch (err) {
    if (err instanceof Error && "committed" in err && err.committed === true && "result" in err) {
      return NextResponse.json({ movement: err.result, committed: true, warning: err.message });
    }
    if (err instanceof MutationConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof InsufficientStockError || err instanceof InsufficientAvailableStockError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Entry save nahi ho payi.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
