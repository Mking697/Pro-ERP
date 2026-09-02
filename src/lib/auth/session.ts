import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "erp_session";
const SESSION_TTL = "8h";

export interface SessionPayload {
  userId: string;
  orgId: string;
  email: string;
  fullName: string;
  role: string;
  /** Module keys this user may work in — see src/lib/moduleAccess.ts. */
  access: string[];
}

let warnedWeakSecret = false;

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Missing JWT_SECRET environment variable.");
  }
  // An HS256 signature is only as strong as this string. A short one can be recovered
  // offline from a single captured cookie, and whoever recovers it can mint a session for
  // any user in any organization — including a platform admin. Warned rather than thrown:
  // refusing to start would take a running deployment down, which is a worse outcome than
  // a loud log the operator can act on.
  if (!warnedWeakSecret && secret.length < 32) {
    warnedWeakSecret = true;
    console.warn(
      `[auth] JWT_SECRET is only ${secret.length} characters. Use at least 32 random characters — a short secret can be brute-forced offline into a forged session.`
    );
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(SESSION_TTL)
    .sign(getSecretKey());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    // The algorithm is pinned rather than taken from the token's own header. A
    // Uint8Array key already restricts jose to HMAC, so this is defence in depth — but it
    // is the one line that makes "whatever alg the attacker wrote" impossible to reach.
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ["HS256"],
    });
    const { userId, orgId, email, fullName, role, access } = payload as Record<string, unknown>;
    // orgId is what scopes every sheet read to one tenant — a token without it is
    // rejected outright rather than being allowed to fall back to some default org.
    if (
      typeof userId !== "string" ||
      typeof orgId !== "string" ||
      typeof email !== "string" ||
      typeof fullName !== "string" ||
      typeof role !== "string" ||
      !Array.isArray(access) ||
      !access.every((a): a is string => typeof a === "string")
    ) {
      return null;
    }
    return { userId, orgId, email, fullName, role, access };
  } catch {
    return null;
  }
}
