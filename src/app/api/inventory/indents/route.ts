import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { createIndent, listIndents, INDENT_REASONS, IndentAdmissionError, type IndentRecord } from "@/lib/inventory/indents";

export async function GET() {
  const guard = await requireModule("INVENTORY_VIEW");
  if (!guard.ok) return guard.response;

  const indents = await listIndents();
  return NextResponse.json({ indents });
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

  const created: IndentRecord[] = [];
  const failed: { sku: string; error: string }[] = [];
  const unknown: { sku: string; error: string }[] = [];
  const warnings: { sku: string; warning: string }[] = [];
  let failureStatus = 400;

  // Sequential, and one failure does not abort the rest: raising ten indents where the
  // third has a bad quantity should still leave the other nine raised.
  for (const input of parsed.data.indents) {
    try {
      created.push(await createIndent({ ...input, requestedBy: guard.session.userId }));
    } catch (err) {
      // The transaction adapter supplies the committed DTO on cleanup failure.
      // Never retry this item or classify its already-written row as a rollback.
      if (err instanceof Error && "committed" in err && err.committed === true && "result" in err) {
        created.push(err.result as IndentRecord);
        warnings.push({ sku: input.sku, warning: "Indent ban gaya; transaction cleanup failed." });
        continue;
      }
      // A typed admission rejection is a definite failure: the transaction never ran, so
      // nothing was written and this SKU is safe to edit and resubmit.
      if (err instanceof IndentAdmissionError) {
        failureStatus = err.status;
        failed.push({ sku: input.sku, error: err.message });
        continue;
      }
      // Any other error (DB/network/adapter failure with no typed rejection and no
      // confirmed-commit marker) is genuinely UNKNOWN, not a definite failure: the
      // adapter's own contract only guarantees rollback-on-reject for an ordinary
      // error, but a lost COMMIT acknowledgement looks identical to the caller.
      // Never call this "failed" — that would invite a blind retry that silently
      // duplicates an indent that was actually written.
      unknown.push({ sku: input.sku, error: "Result confirm nahi hua." });
    }
  }

  return NextResponse.json({
    created: created.length, indents: created, failed,
    ...(unknown.length ? { unknown } : {}),
    ...(created.length && (unknown.length || warnings.length) ? { committed: true } : {}),
    ...(warnings.length ? { warnings } : {}),
  }, {
    status: unknown.length ? 500 : created.length ? 200 : failureStatus,
  });
}
