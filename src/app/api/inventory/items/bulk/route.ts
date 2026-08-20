import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { bulkUpdatePlanningFields } from "@/lib/inventory/items";

// null clears a field back to "not set", which the reorder maths treats differently
// from zero — so it has to survive validation rather than being coerced away.
const clearableNumber = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (v === null || String(v).trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });

const bodySchema = z.object({
  updates: z
    .array(
      z.object({
        sku: z.string().trim().min(1),
        ADC_Manual: clearableNumber,
        Lead_Time_Days: clearableNumber,
        Safety_Factor: clearableNumber,
        MOQ: clearableNumber,
        Max_Level: clearableNumber,
      })
    )
    .min(1, "Koi badlaav nahi mila."),
});

export async function POST(request: Request) {
  const guard = await requireModule("INVENTORY_SETUP");
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
    const result = await bulkUpdatePlanningFields(
      parsed.data.updates.map(({ sku, ...fields }) => ({
        sku,
        // Only keys the caller actually sent are applied; an absent key leaves the
        // existing value alone, which is what makes partial edits safe.
        fields: Object.fromEntries(
          Object.entries(fields).filter(([, v]) => v !== undefined)
        ),
      }))
    );

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
