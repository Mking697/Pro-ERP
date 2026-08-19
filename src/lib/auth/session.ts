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

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Missing JWT_SECRET environment variable.");
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
    const { payload } = await jwtVerify(token, getSecretKey());
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
