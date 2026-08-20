import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { tryModule } from "@/lib/moduleSheets";
import { createIndent, listIndents, INDENT_REASONS } from "@/lib/inventory/indents";

export async function GET() {
  const guard = await requireModule("INVENTORY_VIEW");
  if (!guard.ok) return guard.response;

  const indents = await tryModule(() => listIndents());
  return NextResponse.json({
    indents: indents ?? [],
    setupRequired: indents === null ? "Indents (Purchase requests)" : null,
  });
}

const bodySchema = z.object({
  indents: z
    .array(
      z.object({
        sku: z.string().trim().min(1),
        itemName: z.string().trim().min(1),
        uom: z.string().trim().min(1),
        suggestedQty: z.coerce.number().nonnegative(),
        finalQty: z.coerce.number().positive("Quantity 0 se zyada honi chahiye."),
        reason: z.enum(INDENT_REASONS).optional().default("Reorder"),
        linkedPlanId: z.string().trim().optional().default(""),
        expectedDate: z.string().trim().optional().default(""),
      })
    )
    .min(1, "Koi item select nahi hua."),
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

  const created = [];
  const failed: { sku: string; error: string }[] = [];

  // Sequential, and one failure does not abort the rest: raising ten indents where the
  // third has a bad quantity should still leave the other nine raised.
  for (const input of parsed.data.indents) {
    try {
      created.push(await createIndent({ ...input, requestedBy: guard.session.userId }));
    } catch (err) {
      failed.push({
        sku: input.sku,
        error: err instanceof Error ? err.message : "Ban nahi paya.",
      });
    }
  }

  return NextResponse.json({ created: created.length, indents: created, failed });
}
