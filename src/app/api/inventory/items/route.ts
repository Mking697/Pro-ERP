import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { createItem, ITEM_CATEGORIES } from "@/lib/inventory/items";
import { getInventorySnapshot } from "@/lib/inventory/service";

export async function GET() {
  const guard = await requireModule("INVENTORY_VIEW");
  if (!guard.ok) return guard.response;

  const snapshot = await getInventorySnapshot();

  return NextResponse.json({
    items: snapshot.items.map((i) => ({
      ...i.item,
      onHand: i.onHand,
      committed: i.committed,
      free: i.free,
      inTransit: i.inTransit,
      projected: i.projected,
      adc: i.adc,
      adcIsManual: i.adcIsManual,
      rop: i.rop,
      status: i.status,
      missingFields: i.missingFields,
    })),
    missingSheets: snapshot.missingSheets,
  });
}

// Blank is meaningful here: it means "not set yet", which the reorder maths treats
// differently from zero. So these coerce empty string to null rather than to 0.
const optionalNumber = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === null || String(v).trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });

const createSchema = z.object({
  sku: z.string().trim().optional(),
  itemName: z.string().trim().min(1, "Item ka naam zaroori hai."),
  category: z.enum(ITEM_CATEGORIES),
  sizeUnit: z.string().trim().optional().default(""),
  uom: z.string().trim().min(1, "UOM zaroori hai."),
  rate: optionalNumber,
  adcManual: optionalNumber,
  leadTimeDays: optionalNumber,
  safetyFactor: optionalNumber,
  moq: optionalNumber,
  maxLevel: optionalNumber,
  location: z.string().trim().optional().default(""),
});

export async function POST(request: Request) {
  const guard = await requireModule("INVENTORY_SETUP");
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const item = await createItem({ ...parsed.data, createdBy: guard.session.email });
    return NextResponse.json({ item });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Item ban nahi paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
