import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { tryModule } from "@/lib/moduleSheets";
import { createBom, listBoms, BomValidationError, COMPONENT_TYPES } from "@/lib/inventory/bom";

export async function GET() {
  const guard = await requireModule("BOM_MANAGE");
  if (!guard.ok) return guard.response;

  const boms = await tryModule(() => listBoms());
  return NextResponse.json({
    boms: boms ?? [],
    setupRequired: boms === null ? "BOM (Bill of Materials)" : null,
  });
}

const bodySchema = z.object({
  productName: z.string().trim().min(1, "Product ka naam zaroori hai."),
  productSku: z.string().trim().optional().default(""),
  lines: z
    .array(
      z.object({
        componentSku: z.string().trim().min(1, "Har line me item chunein."),
        componentName: z.string().trim().min(1),
        componentType: z.enum(COMPONENT_TYPES).optional().default("Item"),
        qtyPerUnit: z.coerce.number().positive("Quantity 0 se zyada honi chahiye."),
        uom: z.string().trim().min(1),
      })
    )
    .min(1, "Kam se kam ek item chahiye."),
});

export async function POST(request: Request) {
  const guard = await requireModule("BOM_MANAGE");
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const bom = await createBom({ ...parsed.data, createdBy: guard.session.email });
    return NextResponse.json({ bom });
  } catch (err) {
    if (err instanceof BomValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "BOM save nahi ho payi.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
