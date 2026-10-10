import { NextResponse } from "next/server";
import { getMutationKey, MutationConflictError } from "@/lib/mutations";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { submitQualityCheck } from "@/lib/inward";

const qualityCheckSchema = z
  .object({
    verifyChecked: z.boolean(),
    passQty: z.coerce.number().min(0),
    failQty: z.coerce.number().min(0),
    failReason: z.string().optional().default(""),
  })
  .refine((data) => data.failQty === 0 || data.failReason.trim().length > 0, {
    message: "Fail Qty ho to Fail Reason zaroori hai.",
    path: ["failReason"],
  });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ entryId: string }> }
) {
  const guard = await requireModule("IQC_CHECK");
  if (!guard.ok) return guard.response;

  const { entryId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = qualityCheckSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  try {
    const entry = await submitQualityCheck({
      entryId,
      verifiedBy: guard.session.userId,
      ...parsed.data,
    }, getMutationKey(request));
    return NextResponse.json({ entry });
  } catch (err) {
    if (err instanceof Error && "committed" in err && err.committed === true && "result" in err) {
      return NextResponse.json({ entry: err.result, committed: true, warning: err.message });
    }
    if (err instanceof MutationConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : "Quality check save nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
