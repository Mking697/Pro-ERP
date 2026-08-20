import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { tryModule } from "@/lib/moduleSheets";
import { listBoms } from "@/lib/inventory/bom";

/**
 * Products that can actually be planned — those with an Active BOM.
 *
 * Separate from `/api/bom` on purpose: a planner needs to pick a product without holding
 * the grant that lets them rewrite what it is made of.
 */
export async function GET() {
  const guard = await requireModule("PPC_PLAN");
  if (!guard.ok) return guard.response;

  const boms = await tryModule(() => listBoms());
  if (boms === null) {
    return NextResponse.json({ products: [], setupRequired: "BOM (Bill of Materials)" });
  }

  const products = boms
    .filter((b) => b.status === "Active")
    .map((b) => ({
      productName: b.productName,
      productSku: b.productSku,
      version: b.version,
      componentCount: b.lines.length,
    }))
    .sort((a, b) => a.productName.localeCompare(b.productName));

  return NextResponse.json({ products, setupRequired: null });
}
