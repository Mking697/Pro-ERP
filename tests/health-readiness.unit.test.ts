import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { expectedMigrationLineage } from "@/lib/expected-migration-lineage";
import path from "node:path";

const local = readMigrationFiles({ migrationsFolder: path.resolve(__dirname, "../drizzle") });
// Raw rows as the @neondatabase/serverless `neon()` query function returns them
// by default (a plain array of row objects — fullResults/arrayMode both false).
const appliedRows = () => local.map((m) => ({ hash: m.hash, created_at: String(m.folderMillis) }));

const h = vi.hoisted(() => ({ query: vi.fn(), neonCalls: vi.fn() }));
vi.mock("@/lib/platform/admin", () => ({ getPlatformAdminEmails: () => [] }));
// Boundary mock: this route talks to @neondatabase/serverless directly (not the
// shared drizzle `db` client from @/db/client) specifically so it can pass a real
// AbortSignal into `fetchOptions` — see the route's own doc comment for why.
vi.mock("@neondatabase/serverless", () => ({
  neon: (connectionString: string) => {
    h.neonCalls(connectionString);
    return { query: h.query };
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  h.query.mockReset();
  vi.stubEnv("DATABASE_URL", "postgres://test-fixture-only.invalid/db");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it("returns 503 for absent DATABASE_URL without ever constructing a neon client", async () => {
  vi.stubEnv("DATABASE_URL", "");
  const { GET } = await import("@/app/api/health/route");
  const response = await GET();
  const body = await response.json();
  expect(response.status).toBe(503);
  expect(body.ready).toBe(false);
  expect(body.status).toBe("ok");
  expect(body.database.error).toBe("DATABASE_NOT_CONFIGURED");
  expect(h.neonCalls).not.toHaveBeenCalled();
  expect(h.query).not.toHaveBeenCalled();
});

it("returns 503 for a reachable database with no applied migration lineage", async () => {
  h.query.mockResolvedValue([]);
  const { GET } = await import("@/app/api/health/route");
  const response = await GET();
  const body = await response.json();
  expect(response.status).toBe(503);
  expect(body.ready).toBe(false);
  expect(body.database.reachable).toBe(true);
  expect(body.database.error).toBe("SCHEMA_MISSING");
});

it("returns 503 when the applied lineage is an older matching prefix", async () => {
  h.query.mockResolvedValueOnce([]).mockResolvedValueOnce(appliedRows().slice(0, -1));
  const { GET } = await import("@/app/api/health/route");
  const response = await GET();
  const body = await response.json();
  expect(response.status).toBe(503);
  expect(body.ready).toBe(false);
  expect(body.database.reachable).toBe(true);
  expect(body.database.error).toBe("SCHEMA_STALE");
});

it.each(["earlier-hash", "timestamp", "order", "extra-row", "non-prefix-shorter"])(
  "returns 503 for divergent applied lineage: %s",
  async (variant) => {
    const rows = appliedRows();
    if (variant === "earlier-hash" || variant === "non-prefix-shorter") rows[0].hash = "different-lineage";
    if (variant === "timestamp") rows[0].created_at = String(Number(rows[0].created_at) + 1);
    if (variant === "order") [rows[0], rows[1]] = [rows[1], rows[0]];
    if (variant === "extra-row") rows.push({ hash: "extra", created_at: String(local.at(-1)!.folderMillis + 1) });
    if (variant === "non-prefix-shorter") rows.pop();
    h.query.mockResolvedValueOnce([]).mockResolvedValueOnce(rows);
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.ready).toBe(false);
    expect(body.database.reachable).toBe(true);
    expect(body.database.error).toBe("SCHEMA_DIVERGENT");
  },
);

it("returns a stable public error code without disclosing database diagnostics", async () => {
  h.query.mockRejectedValue(new Error("postgres://admin:***@internal.example/db token=super-secret"));
  const { GET } = await import("@/app/api/health/route");
  const response = await GET();
  const body = await response.json();
  expect(response.status).toBe(503);
  expect(body.database.error).toBe("DATABASE_UNAVAILABLE");
  expect(body.database.reachable).toBe(false);
  expect(JSON.stringify(body)).not.toMatch(/super-secret|postgres:\/\/|internal\.example|admin:secret/);
});

it.each(["success", "failure"])("clears the readiness timer after query %s", async (outcome) => {
  const { GET } = await import("@/app/api/health/route");
  vi.useFakeTimers();
  if (outcome === "success") h.query.mockResolvedValueOnce([]).mockResolvedValueOnce(appliedRows());
  else h.query.mockRejectedValue(new Error("connection failed"));
  const response = await GET();
  const body = await response.json();
  expect(response.status).toBe(outcome === "success" ? 200 : 503);
  expect(body.ready).toBe(outcome === "success");
  if (outcome === "success") {
    expect(body.database.schemaVersion).toEqual({ hash: local.at(-1)!.hash, appliedAtMs: local.at(-1)!.folderMillis });
    expect(h.neonCalls).toHaveBeenCalledOnce();
    expect(h.query).toHaveBeenCalledTimes(2);
  }
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds a hung probe at 2500ms and reports DATABASE_TIMEOUT", async () => {
  const { GET } = await import("@/app/api/health/route");
  vi.useFakeTimers();
  h.query.mockImplementation(() => new Promise(() => {}));
  let settled = false;
  const pending = GET().then((response) => { settled = true; return response; });
  await vi.advanceTimersByTimeAsync(0);
  expect(h.query).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(2499);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  const response = await pending;
  const body = await response.json();
  expect(response.status).toBe(503);
  expect(body.database.error).toBe("DATABASE_TIMEOUT");
  expect(body.database.reachable).toBe(false);
  expect(body.database.latencyMs).toBe(2500);
  expect(vi.getTimerCount()).toBe(0);
});

it("aborts the in-flight fetch via a real AbortSignal on timeout — not just an abandoned Promise.race", async () => {
  const { GET } = await import("@/app/api/health/route");
  vi.useFakeTimers();
  let capturedSignal: AbortSignal | undefined;
  h.query.mockImplementation((_text: string, _params: unknown[], opts?: { fetchOptions?: { signal?: AbortSignal } }) => {
    capturedSignal = opts?.fetchOptions?.signal;
    return new Promise(() => {}); // only resolves if something actually cancels it
  });
  const pending = GET();
  await vi.waitFor(() => expect(h.query).toHaveBeenCalledOnce());
  expect(capturedSignal).toBeInstanceOf(AbortSignal);
  expect(capturedSignal?.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(2500);
  const response = await pending;
  expect(response.status).toBe(503);
  // The signal actually passed to the outgoing driver call was aborted — this is
  // real cancellation of the in-flight request, not merely giving up on waiting.
  expect(capturedSignal?.aborted).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["42P01", "3F000"])("reports missing migration metadata for wrapped PostgreSQL code %s", async (code) => {
  h.query.mockResolvedValueOnce([]).mockRejectedValueOnce(
    Object.assign(new Error("diagnostic token=secret"), { code }),
  );
  const { GET } = await import("@/app/api/health/route");
  const response = await GET();
  const body = await response.json();
  expect(response.status).toBe(503);
  expect(body.database.reachable).toBe(true);
  expect(body.database.error).toBe("SCHEMA_MISSING");
  expect(JSON.stringify(body)).not.toMatch(/diagnostic|token=secret/);
});

it("does not echo untrusted migration row content into the public response", async () => {
  const rows = appliedRows();
  rows[rows.length - 1].hash = "private-secret".repeat(1000);
  h.query.mockResolvedValueOnce([]).mockResolvedValueOnce(rows);
  const { GET } = await import("@/app/api/health/route");
  const response = await GET();
  const body = await response.json();
  expect(response.status).toBe(503);
  expect(body.database.error).toBe("SCHEMA_DIVERGENT");
  expect(body.database.schemaVersion).toBeNull();
  expect(JSON.stringify(body)).not.toContain("private-secret");
});

it("does not start the schema-lineage query after the reachability probe itself times out", async () => {
  const { GET } = await import("@/app/api/health/route");
  vi.useFakeTimers();
  h.query.mockImplementation(() => new Promise(() => {}));
  const pending = GET();
  await vi.waitFor(() => expect(h.query).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(2500);
  expect((await pending).status).toBe(503);
  expect(h.query).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("packages exactly the current SQL hashes and ordered journal timestamps", () => {
  expect(expectedMigrationLineage).toEqual(local.map(({ hash, folderMillis }) => ({ hash, folderMillis })));
});

it("bounds migration query rows while retaining one extra row to detect newer schemas", async () => {
  h.query.mockResolvedValueOnce([]).mockResolvedValueOnce(appliedRows());
  const { GET } = await import("@/app/api/health/route");
  expect((await GET()).status).toBe(200);
  expect(h.query.mock.calls[1][0]).toMatch(/ORDER BY created_at, id LIMIT \$1$/);
  expect(h.query.mock.calls[1][1]).toEqual([local.length + 1]);
});

it("also bounds a hung migration lookup after the reachability probe succeeds", async () => {
  const { GET } = await import("@/app/api/health/route");
  vi.useFakeTimers();
  h.query.mockResolvedValueOnce([]).mockImplementationOnce(() => new Promise(() => {}));
  const pending = GET();
  await vi.waitFor(() => expect(h.query).toHaveBeenCalledTimes(2));
  await vi.advanceTimersByTimeAsync(2500);
  const response = await pending;
  const body = await response.json();
  expect(response.status).toBe(503);
  expect(body.ready).toBe(false);
  expect(body.database.reachable).toBe(true);
  expect(body.database.error).toBe("DATABASE_TIMEOUT");
  expect(vi.getTimerCount()).toBe(0);
});
