import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { runWithTenant } from "@/lib/tenant";
import { getMutationKey, MutationConflictError, MutationInputError } from "@/lib/mutations";
import { CostingError } from "./validation";

/** Each handler owns authorization; tenant context never comes from request data. */
export async function costingRoute(work: () => Promise<Response>): Promise<Response> {
  try {
    const guard = await requireModule("COST_SHEETS");
    if (!guard.ok) return guard.response;
    const response = await runWithTenant(guard.tenant, work);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const status = error instanceof CostingError || error instanceof MutationConflictError || error instanceof MutationInputError ? error.status : error instanceof ZodError || error instanceof SyntaxError ? 400 : 500;
    const message = error instanceof ZodError ? error.issues[0]?.message ?? "Invalid cost sheet input" : status < 500 && error instanceof Error ? error.message : "Cost sheet request failed";
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}
export function costingMutationKey(request: Request): string {
  const key = getMutationKey(request);
  if (!key) throw new CostingError("Idempotency-Key is required");
  return key;
}
