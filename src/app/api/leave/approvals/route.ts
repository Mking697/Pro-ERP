import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { listPendingApprovalsFor } from "@/lib/leave/leaves";

export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const leaves = await listPendingApprovalsFor(guard.session.userId);
  return NextResponse.json({ leaves });
}
