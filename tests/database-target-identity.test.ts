import { describe, expect, it } from "vitest";
import { assertDisposableDatabaseTarget as guard } from "./helpers/databaseTargetGuard";
const approved = "postgresql://localhost:5432/pro_erp_test";

describe("disposable database identity", () => {
  it("rejects an implicit connection port that could inherit PGPORT", () => {
    expect(() => guard("postgresql://localhost/pro_erp_test", approved)).toThrow();
  });
  it.each(["host=prod-host", "port=9999", "database=prod_db", "dbname=prod_db"])("rejects connection-string routing override %s", (query) => {
    expect(() => guard(`${approved}?${query}`, approved)).toThrow();
  });
  it("rejects a missing declaration", () => {
    expect(() => guard(approved, undefined)).toThrow(/TEST_DATABASE_TARGET/);
  });
  it("rejects a missing URL", () => {
    expect(() => guard(undefined, approved)).toThrow(/DATABASE_URL/);
  });
  it.each([".*", "pro_erp_test", "("])("rejects unrestricted or regex declaration %s", (declaration) => {
    expect(() => guard(approved, declaration)).toThrow();
  });
  it.each([
    "postgresql://user:pro_erp_test@prod-host/prod_db",
    "postgresql://user:pw@prod-host/prod_db?target=localhost:5432/pro_erp_test",
    "postgresql://prod-host/prod_db#localhost:5432/pro_erp_test",
    "postgresql://localhost:5432/prod_db?db=pro_erp_test",
    "postgresql://prod-host:5432/pro_erp_test",
    "postgresql://localhost:5433/pro_erp_test",
  ])("rejects mismatched identity regardless of other URL text: %s", (url) => {
    expect(() => guard(url, approved)).toThrow();
  });
  it.each(["not a url", "https://localhost:5432/pro_erp_test", "postgresql://localhost", "postgresql://localhost/a/b"])("rejects invalid database URL %s", (url) => {
    expect(() => guard(url, approved)).toThrow();
  });
  it("accepts the explicitly approved loopback host, port and database", () => {
    expect(() => guard("postgres://user:pw@localhost:5432/pro_erp_test?sslmode=disable", approved)).not.toThrow();
  });
  it("accepts an explicitly declared disposable CI identity", () => {
    expect(() => guard("postgresql://ci:pw@ci-disposable.example:5432/qa_ci?sslmode=require", "postgresql://ci-disposable.example:5432/qa_ci")).not.toThrow();
  });
  it.each([
    "postgresql://user:pw@localhost:5432/pro_erp_test",
    "postgresql://localhost:5432/pro_erp_test?allow=all",
    "postgresql://localhost:5432/pro_erp_test#all",
    "postgresql://localhost:5432/",
  ])("rejects non-identity declaration %s", (declaration) => {
    expect(() => guard(approved, declaration)).toThrow();
  });
});
