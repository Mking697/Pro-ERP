import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { rateLimitHits } from "@/db/schema";

/**
 * A plain fixed-window counter, backed by Postgres rather than in-memory — Vercel's
 * serverless functions don't share memory between instances, so an in-process counter
 * would only ever see a fraction of the real traffic. Deliberately simple (fixed window,
 * not sliding/token-bucket): good enough to stop a naive brute-force/scrape loop against
 * `/api/signup`, `/api/auth/login`, and `/share/[token]`, not a defense against a
 * distributed attacker rotating IPs.
 */
export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the current window resets — only meaningful when `allowed` is false. */
  retryAfterSeconds: number;
}

export async function checkRateLimit(
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1000;
  const windowStartMs = Math.floor(Date.now() / windowMs) * windowMs;
  const windowStart = new Date(windowStartMs);
  const id = `${scope}:${identifier}:${windowStartMs}`;

  const [row] = await db
    .insert(rateLimitHits)
    .values({ id, scope, identifier, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: rateLimitHits.id,
      set: { count: sql`${rateLimitHits.count} + 1` },
    })
    .returning({ count: rateLimitHits.count });

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((windowStartMs + windowMs - Date.now()) / 1000)
  );

  return { allowed: row.count <= limit, retryAfterSeconds };
}

/** Best-effort real client IP behind Vercel's proxy — falls back to a constant bucket
 * (still rate-limits, just as one shared pool) when nothing is set, e.g. local dev. */
export function clientIp(request: Request): string {
  return ipFromHeaderLookup(request.headers.get.bind(request.headers));
}

/** Same as `clientIp`, for a Server Component that only has `headers()` (a `ReadonlyHeaders`
 * from next/headers), not the raw `Request` a route handler gets. */
export function clientIpFromHeaders(headerList: { get(name: string): string | null }): string {
  return ipFromHeaderLookup(headerList.get.bind(headerList));
}

function ipFromHeaderLookup(get: (name: string) => string | null): string {
  const forwarded = get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return get("x-real-ip") ?? "unknown";
}
