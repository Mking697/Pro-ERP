import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { SOURCE_MODULES } from "@/lib/fms/sourceModules";

/**
 * Every domain module's key/label/headers — lets the template builder's "Existing FMS"
 * data source picker offer real source modules and real columns instead of a hardcoded
 * list that drifts from src/lib/fms/sourceModules.ts.
 */
export async function GET() {
  const guard = await requireModule("FMS_ADMIN");
  if (!guard.ok) return guard.response;

  const modules = SOURCE_MODULES.map((m) => ({ key: m.key, label: m.label, headers: m.headers }));
  return NextResponse.json({ modules });
}
