import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { SOURCE_MODULES } from "@/lib/fms/sourceModules";
import { listSourceModuleRows } from "@/lib/fms/dataSourceResolver";
import { tenantCached } from "@/lib/cache";
import { getTenantOrgId } from "@/lib/tenant";

/**
 * Backs an FMS "lookup" form field: the doer picks a row from another connected module
 * (e.g. Customers) and the rest of the step's form autofills from it — see
 * src/lib/fms/dataSource.ts's FormFieldLookup.
 *
 * Any signed-in user can call this: it's read access to reference data needed to complete
 * a task already assigned to them, not gated behind a module grant like a "real" module
 * page would be — the same tier `getFmsStepContext`'s caller uses in
 * src/app/api/fms/steps/[runId]/route.ts.
 */
export async function GET(request: Request) {
  const guard = await requireSession();
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const moduleKey = searchParams.get("module") ?? "";

  // Only a real source module key is ever accepted — this must never become a way to
  // probe for module keys that don't exist.
  if (!SOURCE_MODULES.some((m) => m.key === moduleKey)) {
    return NextResponse.json({ error: "Invalid module." }, { status: 400 });
  }

  const orgId = await getTenantOrgId();
  try {
    const rows = await tenantCached(orgId, `fms-lookup-source:${moduleKey}`, 30_000, () =>
      listSourceModuleRows(moduleKey)
    );
    return NextResponse.json({ rows });
  } catch {
    // Unreadable for some reason — an empty list lets the picker render (nothing to pick)
    // rather than erroring the whole step-completion dialog.
    return NextResponse.json({ rows: [] });
  }
}
