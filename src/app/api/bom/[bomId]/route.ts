import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { setBomStatus } from "@/lib/inventory/bom";

const patchSchema = z.object({ status: z.enum(["Active", "Archived"]) });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ bomId: string }> }
) {
  const guard = await requireModule("BOM_MANAGE");
  if (!guard.ok) return guard.response;

  const { bomId } = await params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  try {
    await setBomStatus(bomId, parsed.data.status);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update nahi ho paya.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
