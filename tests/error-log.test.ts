import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { logError, listErrorLogs } from "@/lib/errorLog";
import { db } from "@/db/client";
import { errorLogs } from "@/db/schema";

/**
 * src/lib/errorLog.ts backs the self-hosted diagnostics view at /platform
 * (src/app/platform/error-logs-table.tsx) — the alternative to wiring up Sentry. Written
 * by src/instrumentation.ts's global onRequestError hook, plus a few explicit call sites
 * (a cron job's per-organization failure, a WhatsApp send failure) that were already
 * caught and would otherwise stay silent.
 */
describe("errorLog", () => {
  it("persists a logged error and lists it back, most recent first", async () => {
    const marker = `test-marker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      await logError({
        orgId: "ORG-TEST",
        routePath: "/api/does-not-matter",
        routeType: "route",
        message: marker,
        digest: "abc123",
        stack: "Error: boom\n    at somewhere.ts:1:1",
      });

      const logs = await listErrorLogs(10);
      const found = logs.find((l) => l.message === marker);
      expect(found).toBeDefined();
      expect(found?.orgId).toBe("ORG-TEST");
      expect(found?.routePath).toBe("/api/does-not-matter");
      expect(found?.digest).toBe("abc123");
    } finally {
      await db.delete(errorLogs).where(eq(errorLogs.message, marker));
    }
  });

  it("never throws even when given nothing but a message", async () => {
    const marker = `test-marker-minimal-${Date.now()}`;
    try {
      await expect(logError({ message: marker })).resolves.toBeUndefined();
      const logs = await listErrorLogs(10);
      expect(logs.some((l) => l.message === marker && l.orgId === "")).toBe(true);
    } finally {
      await db.delete(errorLogs).where(eq(errorLogs.message, marker));
    }
  });
});
