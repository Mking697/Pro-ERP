import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";

/**
 * Returns just the caller's own orgId — nothing else. Exists purely so client components
 * that need to build an org-scoped Blob upload path (see file-upload-field.tsx and
 * src/app/api/blob/upload/route.ts's pathnamePatternFor()) can get it without decoding the
 * httpOnly session cookie themselves (they can't — it's httpOnly by design).
 */
export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;
  return NextResponse.json({ orgId: guard.session.orgId });
}
