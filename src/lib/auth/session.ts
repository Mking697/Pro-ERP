import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "erp_session";
const SESSION_TTL = "8h";

export interface SessionPayload {
  userId: string;
  email: string;
  fullName: string;
  role: string;
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
    const { userId, email, fullName, role } = payload as Record<string, unknown>;
    if (
      typeof userId !== "string" ||
      typeof email !== "string" ||
      typeof fullName !== "string" ||
      typeof role !== "string"
    ) {
      return null;
    }
    return { userId, email, fullName, role };
  } catch {
    return null;
  }
}
