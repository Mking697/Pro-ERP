import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/apiAccess/apiKeys";
import { checkRateLimit, clientIp } from "@/lib/rateLimit";
import { runWithTenant, tenantFromOrgId, TenantResolutionError } from "@/lib/tenant";

/** Same `{ ok: true, ... } | { ok: false, response }` shape convention as
 * src/lib/auth/guard.ts's own GuardResult — just carrying a plain `orgId` instead of a
 * cookie-session's `session`, since an API-key caller has no session at all. */
type ApiKeyGuardResult = { ok: true; orgId: string } | { ok: false; response: NextResponse };

const unauthorized = (message = "Unauthorized.") =>
  NextResponse.json({ error: message }, { status: 401 });

const throttled = (retryAfterSeconds: number) => NextResponse.json(
  { error: "Rate limit cross ho gayi. Thodi der baad try karein." },
  { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
);

async function invalidKey(request: Request, message: string): Promise<ApiKeyGuardResult> {
  // One failure bucket per IP, not per guessed secret: rotating guesses cannot reset it.
  // Only failures consume this budget, so integrations sharing a NAT remain usable.
  const rate = await checkRateLimit("api-v1-invalid", clientIp(request), 10, 60);
  return { ok: false, response: rate.allowed ? unauthorized(message) : throttled(rate.retryAfterSeconds) };
}

/**
 * IP admission caps verifier work at 300/min regardless of rotating bearer guesses.
 * Invalid credentials also receive 429 after 10/min/IP; valid keys retain a separate
 * 300/min budget across IPs. Persist only fingerprints, never bearer secrets.
 */
export async function requireApiKey(request: Request): Promise<ApiKeyGuardResult> {
  // Charge admission BEFORE verification and independently of the guessed secret.
  // Otherwise rotating guesses still reach the verifier even when failure responses
  // are 429. This hard ceiling also bounds work for simultaneous/valid guesses.
  const admission = await checkRateLimit("api-v1-auth", clientIp(request), 300, 60);
  if (!admission.allowed) return { ok: false, response: throttled(admission.retryAfterSeconds) };
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const plaintextKey = match?.[1].trim();
  if (!plaintextKey) {
    return invalidKey(request, "Authorization: Bearer <api key> header chahiye.");
  }

  const orgId = await verifyApiKey(plaintextKey);
  if (!orgId) {
    return invalidKey(request, "API key invalid ya revoked hai.");
  }

  const fingerprint = createHash("sha256").update(plaintextKey).digest("hex");
  const rate = await checkRateLimit("api-v1", fingerprint, 300, 60);
  if (!rate.allowed) {
    return { ok: false, response: throttled(rate.retryAfterSeconds) };
  }

  return { ok: true, orgId };
}

/**
 * Convenience wrapper for every `/api/v1/*` route: authenticates the bearer key, resolves
 * it into a real `TenantContext` (so the existing session-based domain lib functions —
 * `listOrders()` etc., which all read their org via `getTenantOrgId()` — work completely
 * unmodified), and runs `work` inside that explicit tenant scope via `runWithTenant()`
 * (src/lib/tenant.ts) — the same explicit-context mechanism cron/background jobs already
 * use for request-less code paths.
 *
 * A suspended/trial-expired org's key still authenticates (the key itself is fine) but
 * reads nothing — mirrors `requireModule()`'s own `resolveTenantOr403()` for session
 * routes, same 403 semantics.
 */
export async function withApiKeyTenant(
  request: Request,
  work: () => Promise<unknown>
): Promise<NextResponse> {
  const guard = await requireApiKey(request);
  if (!guard.ok) return guard.response;

  try {
    const tenant = await tenantFromOrgId(guard.orgId);
    const result = await runWithTenant(tenant, work);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof TenantResolutionError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }
}
