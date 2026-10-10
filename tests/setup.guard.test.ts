import { describe, expect, it } from "vitest";
import { assertDisposableDatabaseTarget } from "./helpers/databaseTargetGuard";

describe("assertDisposableDatabaseTarget", () => {
  it("refuses a database name mentioned only in the password", () => {
    expect(() => assertDisposableDatabaseTarget(
      "postgresql://user:pro_erp_test@prod-host/prod_db", "pro_erp_test",
    )).toThrow();
  });
  it("throws when no approved target is declared, even if DATABASE_URL is set", () => {
    expect(() =>
      assertDisposableDatabaseTarget("postgresql://user:pw@prod-host/prod_db", undefined),
    ).toThrow(/TEST_DATABASE_TARGET/);
  });

  it("throws when DATABASE_URL is unset, even if a target is declared", () => {
    expect(() => assertDisposableDatabaseTarget(undefined, "test_db")).toThrow(/DATABASE_URL/);
  });

  it("throws when a legacy database-name pattern is supplied", () => {
    expect(() =>
      assertDisposableDatabaseTarget("postgresql://user:pw@prod-host/prod_db", "pro_erp_test"),
    ).toThrow();
  });

  it("throws when the declaration is not a valid PostgreSQL URL", () => {
    expect(() =>
      assertDisposableDatabaseTarget("postgresql://user:pw@host/pro_erp_test", "("),
    ).toThrow(/valid PostgreSQL URL/);
  });

  it("passes silently when DATABASE_URL matches the approved identity", () => {
    expect(() =>
      assertDisposableDatabaseTarget("postgresql://user:pw@host:5432/pro_erp_test", "postgresql://host:5432/pro_erp_test"),
    ).not.toThrow();
  });
});
