import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { dismissOnboarding } from "@/lib/onboarding";

/** Admin dismisses the first-run onboarding checklist on /dashboard — permanent per org,
 * via the existing settings key-value table (see src/lib/onboarding.ts). */
export async function POST() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  await dismissOnboarding();

  return NextResponse.json({ success: true });
}
