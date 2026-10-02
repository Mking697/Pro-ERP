import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tenantScopedTableExportNames } from "@/lib/platform/tenantTables";

/**
 * `deleteOrganization()`'s cascade (src/lib/platform/registry.ts) has broken silently
 * FOUR separate times in this project's history as new tenant-scoped tables were added
 * without a matching `db.delete(...)` line — see CLAUDE.md's "Working notes" section,
 * "the single most-recurring bug across the whole migration." This test closes that gap
 * for good: rather than relying on a human to grep the function every time a table is
 * added, it reads `registry.ts`'s own source text and checks, for every table the schema
 * module itself says is tenant-scoped (via `tenantScopedTables()` — the same reflection
 * `usageMetrics.ts` already uses), that a `db.delete(<thatTable>)` call actually appears
 * in the file. A future PR that adds a new `orgId` column without adding its own cascade
 * line fails this test immediately, in CI, before it ever reaches production — rather than
 * waiting for a real org to touch that table and throw a raw FK-violation on delete.
 *
 * Deliberately a static source-text check, not a live `deleteOrganization()` probe that
 * seeds one row per table (that already exists — see platform-registry-cascade.test.ts,
 * which checks six representative tables live) — this one is cheap, exhaustive over every
 * table the schema currently has (not just six samples), and fails with the exact missing
 * table name in its assertion message.
 */
describe("deleteOrganization cascade completeness", () => {
  it("has a db.delete(...) line for every tenant-scoped table in the schema", () => {
    const registrySource = readFileSync(
      resolve(__dirname, "../src/lib/platform/registry.ts"),
      "utf-8"
    );

    const missing: string[] = [];
    for (const exportName of tenantScopedTableExportNames()) {
      // Matches `db.delete(stockLedger)` but not e.g. a comment merely mentioning the name
      // — real call-site syntax only, so a renamed-but-not-wired table still fails loudly.
      const pattern = new RegExp(`db\\.delete\\(\\s*${exportName}\\s*\\)`);
      if (!pattern.test(registrySource)) missing.push(exportName);
    }

    expect(
      missing,
      `deleteOrganization() is missing a db.delete(...) cascade line for: ${missing.join(", ")}. ` +
        `Every tenant-scoped table (one with an orgId column) must be added to registry.ts's ` +
        `db.batch() list in the same change that adds the table — see CLAUDE.md's own working ` +
        `notes on why this is the single most-recurring bug in this codebase's history.`
    ).toEqual([]);
  });

  it("every db.delete(...) line in the cascade still refers to a real tenant-scoped table", () => {
    // The inverse check: catches a table removed from the schema (or renamed) whose own
    // cascade line was never cleaned up — dead weight, not a correctness bug on its own,
    // but worth keeping clean so the list stays a trustworthy map of what's really there.
    const registrySource = readFileSync(
      resolve(__dirname, "../src/lib/platform/registry.ts"),
      "utf-8"
    );
    const cascadeCalls = [
      ...registrySource.matchAll(/db\.delete\(\s*(\w+)\s*\)\.where\(eq\(\1\.orgId/g),
    ].map((m) => m[1]);

    const knownTables = new Set(tenantScopedTableExportNames());
    // organizations/usersIndex are deliberately NOT in tenantScopedTables() (organizations
    // itself has no orgId column — it IS the tenant; usersIndex's own org_id FK is real but
    // it's platform-registry data, not domain business data) yet both have a legitimate
    // cascade line in registry.ts for the same "nothing left behind" reasoning — allow them.
    // tenantUsageMetrics is excluded from tenantScopedTables() too (NOT_TENANT_OWNED, so
    // usageMetrics.ts's own cross-org aggregation doesn't try to measure itself) but IS
    // real tenant data meant to be wiped with its org — CLAUDE.md documents this exact
    // asymmetry (unlike error_logs/rate_limit_hits, a usage-share row is meaningless once
    // its org is gone, so it alone of the three NOT_TENANT_OWNED tables gets a cascade line).
    const allowed = new Set(["organizations", "usersIndex", "tenantUsageMetrics"]);

    const unexpected = cascadeCalls.filter((name) => !knownTables.has(name) && !allowed.has(name));
    expect(unexpected, `Unexpected cascade entries not backed by a real org_id table: ${unexpected.join(", ")}`).toEqual([]);
  });
});
