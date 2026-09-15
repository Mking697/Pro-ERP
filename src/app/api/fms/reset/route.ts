import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guard";
import { resetAllFmsData } from "@/lib/fms/reset";

/**
 * Wipes every FMS template and every run/instance (pending + history) for the org — see
 * src/lib/fms/reset.ts. Admin-only: this is a full, irreversible reset, a bigger blast
 * radius than the per-template Archive-then-Delete flow FMS_ADMIN already has.
 */
export async function POST() {
  const guard = await requireRole(["Admin"]);
  if (!guard.ok) return guard.response;

  const result = await resetAllFmsData();
  return NextResponse.json(result);
}
