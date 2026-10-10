import { assertDisposableDatabaseTarget } from "./helpers/databaseTargetGuard";

// No dotenv fallback: DB-backed tests require explicit externally supplied approval.
// TEST_DATABASE_TARGET is a credential-free PostgreSQL URL naming the disposable
// host, optional port (defaults to 5432), and database. Legacy regexes are not trusted.
assertDisposableDatabaseTarget(process.env.DATABASE_URL, process.env.TEST_DATABASE_TARGET);
