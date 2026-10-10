import { expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ config: vi.fn(), databaseImport: vi.fn() }));
vi.mock("dotenv", () => ({ config: h.config }));
vi.mock("../src/db/client", () => {
  h.databaseImport();
  throw new Error("Pure migration helper must not load the DB");
});

it("importing the lineage helper neither loads dotenv nor evaluates the DB module", async () => {
  const { diagnoseMigrationLineage } = await import("../scripts/check-migration-sync");
  expect(diagnoseMigrationLineage([], [])).toEqual({ status: "in-sync", count: 0 });
  expect(h.config).not.toHaveBeenCalled();
  expect(h.databaseImport).not.toHaveBeenCalled();
});
