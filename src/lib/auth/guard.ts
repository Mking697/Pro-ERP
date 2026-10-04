import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq, and } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { verifySession, SESSION_COOKIE, type SessionPayload } from "@/lib/auth/session";
import { getModuleAccessDefinition, type ModuleAccessKey } from "@/lib/moduleAccess";
import { isPlatformAdmin } from "@/lib/platform/admin";
import { tenantFromOrgId, TenantResolutionError } from "@/lib/tenant";
import { moduleAllowedForPlan } from "@/lib/platform/planLimits";

type GuardResult =
  | { ok: true; session: SessionPayload }
  | { ok: false; response: NextResponse };

const unauthorized = () =>
  NextResponse.json({ error: "Unauthorized." }, { status: 401 });

/** For use inside API route handlers — just checks that someone is logged in.
 *
 * Also re-checks the signed-in user's live `tokenVersion` against the JWT's own snapshot
 * of it (one indexed Postgres read, same cost model as resolveTenantOr403's own tenant
 * read below). Without this, a deactivated/role-downgraded/module-revoked/
 * password-reset user's already-issued cookie kept working exactly as before for the rest
 * of its 8h lifetime — the signature still verified, and nothing else in the request path
 * ever looked at whether the account behind it had changed since. See updateUser()/
 * resetUserPassword() in src/lib/auth/users.ts for where tokenVersion gets bumped. */
export async function requireSession(): Promise<GuardResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    return { ok: false, response: unauthorized() };
  }

  const [row] = await db
    .select({ tokenVersion: users.tokenVersion, status: users.status })
    .from(users)
    .where(and(eq(users.orgId, session.orgId), eq(users.id, session.userId)))
    .limit(1);

  if (!row || row.status !== "Active" || Number(row.tokenVersion) !== session.tokenVersion) {
    return { ok: false, response: unauthorized() };
  }

  return { ok: true, session };
}

/** For use inside API route handlers — checks session + role, returns a ready 401/403 response on failure. */
export async function requireRole(allowedRoles: string[]): Promise<GuardResult> {
  const guard = await requireSession();
  if (!guard.ok) return guard;

  if (!allowedRoles.includes(guard.session.role)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden." }, { status: 403 }),
    };
  }

  return guard;
}

/**
 * Resolves the caller's tenant (org must exist, be Active, and not be a trial-expired
 * Trial org — see tenantFromOrgId()) into a ready 403, or null if resolution succeeded.
 *
 * This is the one new DB read `requireModule`/`requireAnyModule` didn't used to make —
 * previously a module check was a pure JWT check, costing no read at all. Reading the org
 * row here is what lets a module-gated route give a clean 403 with a real message
 * ("trial ended" / "organization suspended") instead of letting a `TenantResolutionError`
 * escape uncaught from whatever `getTenant()` call happens further down the same route —
 * mirrors the login route's own existing catch of the same error. One extra Postgres read
 * per guarded call is the accepted cost, per this codebase's own stated "Postgres reads
 * are fast, no caching needed" philosophy.
 */
async function resolveTenantOr403(
  session: SessionPayload
): Promise<{ org: Awaited<ReturnType<typeof tenantFromOrgId>>["org"] } | { response: NextResponse }> {
  try {
    const tenant = await tenantFromOrgId(session.orgId);
    return { org: tenant.org };
  } catch (error) {
    if (error instanceof TenantResolutionError) {
      return { response: NextResponse.json({ error: error.message }, { status: 403 }) };
    }
    throw error;
  }
}

/**
 * For use inside API route handlers — checks the caller holds a specific module grant AND
 * that the organization's own plan currently allows that module (src/lib/platform/
 * planLimits.ts's `moduleAllowedForPlan` — today this only ever actually blocks a
 * trial-expired org via the tenant-resolution check below, since every real paid tier is
 * approved to include every existing module; the check stays generic so a future
 * tier-exclusive module needs no new plumbing here).
 *
 * The per-user grant still lives on the session (baked into the JWT at login, see
 * effectiveModuleAccess) — only the plan/tenant half of this check is a real read.
 */
export async function requireModule(key: ModuleAccessKey): Promise<GuardResult> {
  const guard = await requireSession();
  if (!guard.ok) return guard;

  const tenantResult = await resolveTenantOr403(guard.session);
  if ("response" in tenantResult) {
    return { ok: false, response: tenantResult.response };
  }

  if (!guard.session.access.includes(key)) {
    const def = getModuleAccessDefinition(key);
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `Aapke paas "${def?.label ?? key}" ka access nahi hai. Apne Admin se kahein.`,
        },
        { status: 403 }
      ),
    };
  }

  if (!moduleAllowedForPlan(tenantResult.org.plan, key)) {
    const def = getModuleAccessDefinition(key);
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `"${def?.label ?? key}" abhi aapke plan me shamil nahi hai. Plan upgrade karwayein.`,
        },
        { status: 403 }
      ),
    };
  }

  return guard;
}

/**
 * The same check, but any one of several grants is enough.
 *
 * Some screens are shared by people holding different grants: inward is worked by whoever
 * makes entries, whoever runs the quality check, and whoever only reads the verified
 * records. Guarding such a route with a single `requireModule` would lock out two of the
 * three, so before this existed it was guarded with `requireSession` alone — which let
 * anybody with a login read every party name, invoice number and attachment URL in the
 * organization. Mirrors `canSeeReport`, which asks the same question for reports.
 */
export async function requireAnyModule(
  keys: readonly ModuleAccessKey[]
): Promise<GuardResult> {
  const guard = await requireSession();
  if (!guard.ok) return guard;

  const tenantResult = await resolveTenantOr403(guard.session);
  if ("response" in tenantResult) {
    return { ok: false, response: tenantResult.response };
  }

  // A held grant only counts if the org's own plan currently allows that specific module —
  // see requireModule()'s own comment for why this is almost always a no-op today.
  const hasAny = keys.some(
    (key) => guard.session.access.includes(key) && moduleAllowedForPlan(tenantResult.org.plan, key)
  );

  if (!hasAny) {
    const labels = keys
      .map((key) => getModuleAccessDefinition(key)?.label ?? key)
      .join(" / ");
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: `Aapke paas "${labels}" me se kisi ka access nahi hai. Apne Admin se kahein.`,
        },
        { status: 403 }
      ),
    };
  }

  return guard;
}

/**
 * For platform-operator routes that span every organization.
 *
 * Deliberately not derived from Role: an organization's Admin is an admin *of that
 * organization*, and must never be able to see or change another customer's data.
 */
export async function requirePlatformAdmin(): Promise<GuardResult> {
  const guard = await requireSession();
  if (!guard.ok) return guard;

  if (!isPlatformAdmin(guard.session.email)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not found." }, { status: 404 }),
    };
  }

  return guard;
}
