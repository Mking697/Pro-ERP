import type { Instrumentation } from "next";

/**
 * Global catch-all for anything an uncaught Route Handler, Server Component, or Server
 * Action throws — the self-hosted alternative to wiring up Sentry (no external
 * account/DSN). Everything this records goes into `error_logs` via `logError()`, readable
 * at `/platform` (Platform Admin only).
 *
 * There is no tenant context here — Next calls this from its own internal error boundary,
 * outside any `runWithTenant()` — so the org is recovered best-effort by reading the
 * session cookie straight out of the raw request headers rather than through the usual
 * `getTenantOrgId()`/`cookies()` helpers, which both assume a request-scoped context this
 * hook doesn't have. A visitor with no session (or an invalid one) simply logs with no org.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  try {
    const { logError } = await import("@/lib/errorLog");
    const { verifySession, SESSION_COOKIE } = await import("@/lib/auth/session");

    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? (err.stack ?? "") : "";
    const digest =
      typeof err === "object" && err !== null && "digest" in err ? String(err.digest) : "";

    let orgId = "";
    const cookieHeader = request.headers["cookie"];
    const cookieString = Array.isArray(cookieHeader) ? cookieHeader.join("; ") : cookieHeader;
    if (cookieString) {
      const match = cookieString
        .split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
      if (match) {
        const token = decodeURIComponent(match.slice(SESSION_COOKIE.length + 1));
        const session = await verifySession(token).catch(() => null);
        if (session) orgId = session.orgId;
      }
    }

    await logError({
      orgId,
      routePath: request.path,
      routeType: context.routeType,
      message,
      digest,
      stack,
    });
  } catch (loggingError) {
    console.error("[instrumentation] onRequestError itself failed:", loggingError);
  }
};
