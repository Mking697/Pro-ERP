import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE, type SessionPayload } from "@/lib/auth/session";
import { getModuleAccessDefinition, type ModuleAccessKey } from "@/lib/moduleAccess";
import { isPlatformAdmin } from "@/lib/platform/admin";

type GuardResult =
  | { ok: true; session: SessionPayload }
  | { ok: false; response: NextResponse };

/** For use inside API route handlers — just checks that someone is logged in. */
export async function requireSession(): Promise<GuardResult> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
    };
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
 * For use inside API route handlers — checks the caller holds a specific module grant.
 *
 * Grants live on the session, so this costs no sheet read. Admins hold every grant
 * implicitly (see effectiveModuleAccess), which is baked into the token at login.
 */
export async function requireModule(key: ModuleAccessKey): Promise<GuardResult> {
  const guard = await requireSession();
  if (!guard.ok) return guard;

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
