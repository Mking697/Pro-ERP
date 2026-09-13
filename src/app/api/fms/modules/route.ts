import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { MODULE_SHEETS } from "@/lib/moduleSheets";

/**
 * Every connected-sheet module's key/label/headers — lets the template builder's
 * "Existing FMS" data source picker offer real source modules and real columns instead
 * of a hardcoded list that drifts from MODULE_SHEETS.
 */
export async function GET() {
  const guard = await requireModule("FMS_ADMIN");
  if (!guard.ok) return guard.response;

  const modules = MODULE_SHEETS.map((m) => ({ key: m.key, label: m.label, headers: m.headers }));
  return NextResponse.json({ modules });
}
