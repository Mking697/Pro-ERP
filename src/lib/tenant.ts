import { AsyncLocalStorage } from "node:async_hooks";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import { getOrganization, type Organization } from "@/lib/platform/registry";
import { isTrialExpired } from "@/lib/platform/planLimits";

export interface TenantContext {
  orgId: string;
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

/**
 * `digest`, when set, identifies WHY resolution failed for callers that want to react
 * differently than "show the raw message" — currently the root `src/app/error.tsx` error
 * boundary, which special-cases "TRIAL_EXPIRED"/"ORG_SUSPENDED" into a friendly upgrade/
 * suspended card instead of a generic error. Next.js preserves a `digest` string already
 * set on a thrown Error across the server->client error-boundary boundary (see
 * node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md) — this is
 * the same field `src/instrumentation.ts`'s `onRequestError` already reads directly off
 * any thrown error for `error_logs`.
 */
export class TenantResolutionError extends Error {
  digest?: "TRIAL_EXPIRED" | "ORG_SUSPENDED";

  constructor(message: string, digest?: "TRIAL_EXPIRED" | "ORG_SUSPENDED") {
    super(message);
    this.digest = digest;
  }
}

export async function tenantFromOrgId(orgId: string): Promise<TenantContext> {
  const org = await getOrganization(orgId);
  if (!org) {
    throw new TenantResolutionError(`Organization "${orgId}" registry me nahi mila.`);
  }
  if (org.status !== "Active") {
    throw new TenantResolutionError(
      `Organization "${org.orgName}" abhi active nahi hai.`,
      "ORG_SUSPENDED"
    );
  }
  // A Trial org whose 14 days are up is locked out exactly like a Suspended org — same
  // exception class, same call site (every real data read already goes through this
  // function via getTenant()/getTenantOrgId()), zero new DB reads, zero staleness. Moving
  // the org onto any real paid plan (see planLimits.ts) makes this permanently false
  // again regardless of what `trialEndsAt` still holds.
  if (isTrialExpired(org)) {
    throw new TenantResolutionError(
      `"${org.orgName}" ka 14-din trial khatm ho gaya hai. Jaari rakhne ke liye Admin se plan upgrade karwayein.`,
      "TRIAL_EXPIRED"
    );
  }
  return { orgId: org.id, org };
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

export async function getTenantOrgId(): Promise<string> {
  return (await getTenant()).orgId;
}
