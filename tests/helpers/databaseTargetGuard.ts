/**
 * Require an operator-approved disposable identity, not a regex over credentials.
 * TEST_DATABASE_TARGET is a credential-free PostgreSQL URL naming one host/port/database.
 * This checks identity, not disposability: the operator must provision/approve the target.
 */
export function assertDisposableDatabaseTarget(
  databaseUrl: string | undefined,
  approvedTarget: string | undefined,
): void {
  if (!approvedTarget) {
    throw new Error("TEST_DATABASE_TARGET is required: declare an approved disposable host/port/database.");
  }
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for database-backed tests.");
  }

  function parse(value: string, label: string): URL {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${label} must be a valid PostgreSQL URL.`);
    }
    if (
      value.trim() !== value ||
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      !url.hostname ||
      !/^\/[A-Za-z0-9_-]+$/.test(url.pathname)
    ) {
      throw new Error(`${label} must name a PostgreSQL host and one database.`);
    }
    return url;
  }

  const approved = parse(approvedTarget, "TEST_DATABASE_TARGET");
  if (approved.username || approved.password || approved.search || approved.hash) {
    throw new Error("TEST_DATABASE_TARGET must contain only host/port/database, without credentials, query or fragment.");
  }
  const actual = parse(databaseUrl, "DATABASE_URL");
  if (!actual.port) {
    throw new Error("DATABASE_URL requires an explicit port to avoid inherited connection defaults.");
  }
  // Drivers may interpret query parameters as connection overrides (not just metadata).
  // Permit only known non-routing options; never let query text select another target.
  const nonRoutingOptions = new Set(["sslmode", "channel_binding", "application_name", "connect_timeout"]);
  for (const key of actual.searchParams.keys()) {
    if (!nonRoutingOptions.has(key)) {
      throw new Error("DATABASE_URL contains an unapproved connection option; refusing database-backed tests.");
    }
  }
  if (
    actual.hostname !== approved.hostname ||
    (actual.port || "5432") !== (approved.port || "5432") ||
    actual.pathname !== approved.pathname
  ) {
    throw new Error("DATABASE_URL identity does not match TEST_DATABASE_TARGET; refusing database-backed tests.");
  }
}
