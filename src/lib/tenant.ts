import { AsyncLocalStorage } from "node:async_hooks";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import { getOrganization, type Organization } from "@/lib/platform/registry";

export interface TenantContext {
  orgId: string;
  /** The organization's own spreadsheet holding its Users and Settings tabs. */
  systemSheetId: string;
  org: Organization;
}

/**
 * Explicit tenant context, for code paths with no logged-in user to derive it from —
 * cron jobs walk every organization and run the same work once per tenant.
 */
const tenantStore = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return tenantStore.run(ctx, fn);
}

export class TenantResolutionError extends Error {}

export async function tenantFromOrgId(orgId: string): Promise<TenantContext> {
  const org = await getOrganization(orgId);
  if (!org) {
    throw new TenantResolutionError(`Organization "${orgId}" registry me nahi mila.`);
  }
  if (org.Status !== "Active") {
    throw new TenantResolutionError(`Organization "${org.Org_Name}" abhi active nahi hai.`);
  }
  if (!org.System_Sheet_ID) {
    throw new TenantResolutionError(
      `"${org.Org_Name}" ka System sheet abhi connect nahi hua hai.`
    );
  }
  return { orgId: org.Org_ID, systemSheetId: org.System_Sheet_ID, org };
}

/**
 * Resolves which organization the current work belongs to: an explicitly-set context
 * wins, otherwise the logged-in user's session decides.
 *
 * Throws when neither exists. That is deliberate — a silent fallback to "some default
 * spreadsheet" is exactly how one tenant ends up reading another's data, so the failure
 * mode here is an error, never a guess.
 */
export async function getTenant(): Promise<TenantContext> {
  const explicit = tenantStore.getStore();
  if (explicit) return explicit;

  let token: string | undefined;
  try {
    const cookieStore = await cookies();
    token = cookieStore.get(SESSION_COOKIE)?.value;
  } catch {
    throw new TenantResolutionError(
      "Tenant context missing: koi request scope nahi hai. Cron/background code ko runWithTenant() use karna chahiye."
    );
  }

  const session = token ? await verifySession(token) : null;
  if (!session) {
    throw new TenantResolutionError("Tenant context missing: koi valid session nahi hai.");
  }

  return tenantFromOrgId(session.orgId);
}

/** The spreadsheet every tenant-scoped Users/Settings read should target. */
export async function getTenantSheetId(): Promise<string> {
  return (await getTenant()).systemSheetId;
}

export async function getTenantOrgId(): Promise<string> {
  return (await getTenant()).orgId;
}
