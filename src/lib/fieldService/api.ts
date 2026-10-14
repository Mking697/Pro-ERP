import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import type { SessionPayload } from "@/lib/auth/session";
import { tenantFromOrgId, runWithTenant, TenantResolutionError } from "@/lib/tenant";
import { moduleAllowedForPlan } from "@/lib/platform/planLimits";
import type { ModuleAccessKey } from "@/lib/moduleAccess";
import { FieldValidationError } from "./validation";
import { FieldAssignmentError } from "./assignments";
import { FieldStepError } from "./steps";
import { ServiceJobError } from "./serviceJobs";
import { ComplaintError } from "./complaints";
import { SiteVisitError } from "./siteVisits";

export const MODULE_FOR_TYPE = {SERVICE:"SERVICE_FMS", COMPLAINT:"COMPLAINT_FMS", SITE_VISIT:"SITE_VISIT_FMS"} as const;
export function forbidden() { return NextResponse.json({error:"Forbidden."}, {status:403}); }
/** All routes, including grant-less assignees, resolve the live org before reads.
 * Ambient cookies never choose the tenant for a library call in this boundary. */
export async function fieldRoute(keys: readonly ModuleAccessKey[], requireStaff: boolean, work: (session: SessionPayload, orgId: string, isStaff: boolean) => Promise<Response>): Promise<Response> {
  try {
    const guard = await requireSession();
    if (!guard.ok) return guard.response;
    const tenant = await tenantFromOrgId(guard.session.orgId);
    const isStaff = keys.some((key) => guard.session.access.includes(key) && moduleAllowedForPlan(tenant.org.plan, key));
    if (requireStaff && !isStaff) return forbidden();
    return await runWithTenant(tenant, () => work(guard.session, tenant.orgId, isStaff));
  } catch (error) {
    if (error instanceof TenantResolutionError) return NextResponse.json({error:error.message}, {status:403});
    if (error instanceof FieldValidationError || error instanceof FieldAssignmentError || error instanceof FieldStepError || error instanceof ServiceJobError || error instanceof ComplaintError || error instanceof SiteVisitError) return NextResponse.json({error:error.message}, {status:400});
    console.error("Field service request failed", error);
    return NextResponse.json({error:"Field service request failed."}, {status:500});
  }
}
export async function jsonObject(request: Request): Promise<Record<string, unknown>> {
  const value: unknown = await request.json().catch(() => null);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FieldValidationError("JSON object required.");
  return value as Record<string, unknown>;
}
