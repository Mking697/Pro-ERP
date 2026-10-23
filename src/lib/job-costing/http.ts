/**
 * J5 — HTTP boundary for Recorded Job Cost Sheets. Mirrors `src/lib/costing/http.ts`
 * exactly (same guard/tenant/error-shape conventions), gated by the distinct
 * `JOB_COST_SHEETS` grant (never the estimated feature's `COST_SHEETS`).
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { runWithTenant } from "@/lib/tenant";
import { getMutationKey, MutationConflictError, MutationInputError } from "@/lib/mutations";
import { JobCostStoreError } from "./store";

/** Each handler owns authorization; tenant context never comes from request data. */
export async function jobCostRoute(work: () => Promise<Response>): Promise<Response> {
  try {
    const guard = await requireModule("JOB_COST_SHEETS");
    if (!guard.ok) return guard.response;
    const response = await runWithTenant(guard.tenant, work);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const status =
      error instanceof JobCostStoreError || error instanceof MutationConflictError || error instanceof MutationInputError
        ? error.status
        : error instanceof ZodError || error instanceof SyntaxError
          ? 400
          : 500;
    const message = error instanceof ZodError
      ? error.issues[0]?.message ?? "Invalid job cost sheet input"
      : status < 500 && error instanceof Error ? error.message : "Job cost sheet request failed";
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}

export function jobCostMutationKey(request: Request): string {
  const key = getMutationKey(request);
  if (!key) throw new JobCostStoreError("Idempotency-Key is required");
  return key;
}
