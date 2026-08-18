import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE, type SessionPayload } from "@/lib/auth/session";

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
