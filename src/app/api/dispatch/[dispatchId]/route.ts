import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { getDispatchDetail } from "@/lib/dispatch/dispatch";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ dispatchId: string }> }
) {
  const guard = await requireModule("DISPATCH_FMS");
  if (!guard.ok) return guard.response;

  const { dispatchId } = await params;
  const detail = await getDispatchDetail(dispatchId);
  if (!detail) {
    return NextResponse.json({ error: "Dispatch nahi mila." }, { status: 404 });
  }
  return NextResponse.json(detail);
}
