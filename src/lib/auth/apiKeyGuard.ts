import { NextResponse } from "next/server";
import { verifyApiKey } from "@/lib/apiAccess/apiKeys";
import { checkRateLimit } from "@/lib/rateLimit";
import { runWithTenant, tenantFromOrgId, TenantResolutionError } from "@/lib/tenant";

/** Same `{ ok: true, ... } | { ok: false, response }` shape convention as
 * src/lib/auth/guard.ts's own GuardResult — just carrying a plain `orgId` instead of a
 * cookie-session's `session`, since an API-key caller has no session at all. */
type ApiKeyGuardResult = { ok: true; orgId: string } | { ok: false; response: NextResponse };

const unauthorized = (message = "Unauthorized.") =>
  NextResponse.json({ error: message }, { status: 401 });

/**
 * For use inside `/api/v1/*` route handlers — reads `Authorization: Bearer <key>`,
 * verifies it (src/lib/apiAccess/apiKeys.ts's `verifyApiKey()`), and returns the calling
 * org's id.
 *
 * Rate-limited per key (reusing src/lib/rateLimit.ts's own fixed-window counter — same
 * utility the unauthenticated `/api/signup` etc. already use), keyed by the raw bearer
 * token itself rather than client IP, since a legitimate integration may call from many
 * IPs behind a shared gateway. Generous ceiling (300/min) — this guards against a
 * runaway/misconfigured integration hammering the API, not normal polling traffic.
 */
export async function requireApiKey(request: Request): Promise<ApiKeyGuardResult> {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, response: unauthorized("Authorization: Bearer <api key> header chahiye.") };
  }
  const plaintextKey = match[1].trim();
  if (!plaintextKey) {
    return { ok: false, response: unauthorized("Authorization: Bearer <api key> header chahiye.") };
  }

  const rateLimit = await checkRateLimit("api-v1", plaintextKey, 300, 60);
  if (!rateLimit.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Rate limit cross ho gayi. Thodi der baad try karein." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } }
      ),
    };
  }

  const orgId = await verifyApiKey(plaintextKey);
  if (!orgId) {
    return { ok: false, response: unauthorized("API key invalid ya revoked hai.") };
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
