import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { deleteHoliday } from "@/lib/holidays";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ date: string }> }
) {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const { date } = await params;
  const deleted = await deleteHoliday(decodeURIComponent(date));
  if (!deleted) {
    return NextResponse.json({ error: "Holiday nahi mila." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
