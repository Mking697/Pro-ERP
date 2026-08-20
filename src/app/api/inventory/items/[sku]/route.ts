import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { updateItem, ITEM_CATEGORIES } from "@/lib/inventory/items";
import { getItemDetail } from "@/lib/inventory/service";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sku: string }> }
) {
  const guard = await requireModule("INVENTORY_VIEW");
  if (!guard.ok) return guard.response;

  const { sku } = await params;
  const detail = await getItemDetail(decodeURIComponent(sku));
  if (!detail) {
    return NextResponse.json({ error: "Item nahi mila." }, { status: 404 });
  }

  const { stock, movements } = detail;
  return NextResponse.json({
    item: stock.item,
    onHand: stock.onHand,
    committed: stock.committed,
    free: stock.free,
    inTransit: stock.inTransit,
    projected: stock.projected,
    adc: stock.adc,
    adcIsManual: stock.adcIsManual,
    rop: stock.rop,
    status: stock.status,
    missingFields: stock.missingFields,
    movements,
  });
}

const optionalNumber = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null || String(v).trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });

const patchSchema = z.object({
  itemName: z.string().trim().min(1).optional(),
  category: z.enum(ITEM_CATEGORIES).optional(),
  sizeUnit: z.string().trim().optional(),
  uom: z.string().trim().min(1).optional(),
  rate: optionalNumber,
  adcManual: optionalNumber,
  leadTimeDays: optionalNumber,
  safetyFactor: optionalNumber,
  moq: optionalNumber,
  maxLevel: optionalNumber,
  location: z.string().trim().optional(),
  status: z.enum(["Active", "Inactive"]).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sku: string }> }
) {
  const guard = await requireModule("INVENTORY_SETUP");
  if (!guard.ok) return guard.response;

  const { sku } = await params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const item = await updateItem(decodeURIComponent(sku), parsed.data);
    return NextResponse.json({ item });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
