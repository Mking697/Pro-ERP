import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { checkRateLimit } from "@/lib/rateLimit";
import { db } from "@/db/client";
import { rateLimitHits } from "@/db/schema";

/**
 * src/lib/rateLimit.ts backs /api/signup, /api/auth/login and /share/[token] — a plain
 * Postgres fixed-window counter, since Vercel's serverless functions share no memory for
 * an in-process counter to live in. Platform-wide (no org_id), same shape as usersIndex.
 */
describe("checkRateLimit", () => {
  it("allows up to the limit, blocks the next attempt, and isolates identifiers", async () => {
    const scope = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const id = "203.0.113.5:someone@example.com";

    try {
      for (let i = 0; i < 3; i++) {
        const r = await checkRateLimit(scope, id, 3, 300);
        expect(r.allowed).toBe(true);
      }

      const blocked = await checkRateLimit(scope, id, 3, 300);
      expect(blocked.allowed).toBe(false);
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

      const otherIdentifier = await checkRateLimit(scope, "198.51.100.9:other@example.com", 3, 300);
      expect(otherIdentifier.allowed).toBe(true);
    } finally {
      await db.delete(rateLimitHits).where(eq(rateLimitHits.scope, scope));
    }
  });
});
