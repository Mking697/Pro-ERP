import { describe, it, expect } from "vitest";
import { diagnoseMigrationLineage } from "../scripts/check-migration-sync";

/**
 * QA-03: the preflight used to only compare COUNTS of applied-vs-local migrations,
 * which lets an equal-count-but-different-content state pass silently (a migration
 * file edited after being applied, or local/remote journals diverging in order).
 * These fixtures are synthetic hash/timestamp pairs — no live DB needed — mirroring
 * the exact ordered-hash-and-timestamp comparison tests/local-isolated/migrate.cjs
 * already proved correct against a real database.
 */
describe("diagnoseMigrationLineage", () => {
  const local = [
    { hash: "h0", folderMillis: 100 },
    { hash: "h1", folderMillis: 200 },
    { hash: "h2", folderMillis: 300 },
  ];

  it("reports in-sync when ordered hash+timestamp lineage matches exactly", () => {
    const applied = local.map((m) => ({ hash: m.hash, when: m.folderMillis }));
    expect(diagnoseMigrationLineage(local, applied)).toEqual({ status: "in-sync", count: 3 });
  });

  it("reports behind when fewer applied than local, with a matching prefix", () => {
    const applied = local.slice(0, 2).map((m) => ({ hash: m.hash, when: m.folderMillis }));
    expect(diagnoseMigrationLineage(local, applied)).toEqual({ status: "behind", appliedCount: 2, localCount: 3 });
  });

  it("reports ahead when more applied than local journal knows", () => {
    const applied = [
      ...local.map((m) => ({ hash: m.hash, when: m.folderMillis })),
      { hash: "h3", when: 400 },
    ];
    expect(diagnoseMigrationLineage(local, applied)).toEqual({ status: "ahead", appliedCount: 4, localCount: 3 });
  });

  it("THE GAP: equal count but a migration's hash was edited after being applied -> drift, not in-sync", () => {
    const applied = local.map((m) => ({ hash: m.hash, when: m.folderMillis }));
    applied[1] = { ...applied[1], hash: "tampered-hash" };
    const diagnosis = diagnoseMigrationLineage(local, applied);
    expect(diagnosis.status).toBe("drift");
    expect(diagnosis).toMatchObject({ status: "drift", index: 1 });
  });

  it("THE GAP: equal count but applied order diverged (timestamps swapped) -> drift, not in-sync", () => {
    const applied = local.map((m) => ({ hash: m.hash, when: m.folderMillis }));
    [applied[1], applied[2]] = [applied[2], applied[1]];
    const diagnosis = diagnoseMigrationLineage(local, applied);
    expect(diagnosis.status).toBe("drift");
    expect(diagnosis).toMatchObject({ status: "drift", index: 1 });
  });
});
