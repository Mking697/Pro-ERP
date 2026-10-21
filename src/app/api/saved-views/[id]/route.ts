import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { deleteSavedView } from "@/lib/savedViews";

/** Delete one saved view — ownership (org + user) is checked inside deleteSavedView()
 * itself, so a stray/foreign id reads as a plain 404 rather than leaking whether the id
 * exists at all for someone else. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const { id } = await params;
  const deleted = await deleteSavedView(guard.session.userId, id);
  if (!deleted) {
    return NextResponse.json({ error: "View nahi mili." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
