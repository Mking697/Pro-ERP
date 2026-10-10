import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { SESSION_COOKIE, verifySession, type SessionPayload } from "@/lib/auth/session";

/** Server-side authentication for pages and API guards, not Edge/proxy or public shares.
 * A valid signature is insufficient: the account must still exist, be Active, and have
 * the tokenVersion issued at login. Deliberately uncached so revocation takes effect on
 * the next lookup. Database errors propagate rather than granting access or hiding an
 * outage as an invalid cookie. Call before starting authenticated data reads. */
export async function getLiveSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getLiveSessionFromToken(token);
}

/** Same live check for tenant resolution, which already reads the cookie and must
 * distinguish a missing request scope from an authentication/database failure. */
export async function getLiveSessionFromToken(token: string | undefined): Promise<SessionPayload | null> {
  const session = token ? await verifySession(token) : null;
  if (!session) return null;

  const [row] = await db
    .select({ tokenVersion: users.tokenVersion, status: users.status })
    .from(users)
    .where(and(eq(users.orgId, session.orgId), eq(users.id, session.userId)))
    .limit(1);

  if (!row || row.status !== "Active" || Number(row.tokenVersion) !== session.tokenVersion) {
    return null;
  }
  return session;
}
