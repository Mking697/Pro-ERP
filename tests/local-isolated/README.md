# Disposable local database tests

These scripts use the **installed** Neon HTTP and Pool/WebSocket drivers against a task-owned PostgreSQL 17 container. They never import dotenv or the default test setup. They do not use the Neon cloud API.

## Recreate on another computer

From the actual repository root, with Docker running and Node/dependencies already installed:

```bash
export PRO_ERP_LOCAL_TESTS=1
export PRO_ERP_LOCAL_CREDENTIALS='<absolute scratch path outside repo>/new-local-test.credentials.json'
node tests/local-isolated/start.cjs
```

The startup script requires cached `postgres:17-alpine` and `ghcr.io/neondatabase/wsproxy:latest` images; it never installs or pulls. Existing resource names or credential files are refused, not replaced. Credentials are generated with `randomBytes`, stored outside Git, restricted with Windows ACLs (or mode 0600), and never printed. PostgreSQL data is tmpfs-only, has no host mounts/ports, and is lost when stopped. Only the WS proxy joins ingress; it publishes `127.0.0.1:55007`, allowlisting exactly `pro-erp-regression-pg:5432`.

In a separate terminal with the same two explicit environment variables:

```bash
node tests/local-isolated/bridge.cjs
```

Do not infer readiness from the launch. From the repository root:

```bash
curl --fail http://127.0.0.1:55008/health
node tests/local-isolated/migrate.cjs
node --test tests/local-isolated/safety.test.cjs
node node_modules/vitest/vitest.mjs run --config tests/local-isolated/smoke.vitest.config.ts
node node_modules/vitest/vitest.mjs run --config tests/atomic-tenant-transactions.real.vitest.config.ts
node node_modules/vitest/vitest.mjs run --config tests/atomic-tenant-transactions.vitest.config.ts
```

Migration checks the actual Pool database/user BEFORE writes, requires exactly 29 migrations, and compares applied hashes/timestamps to installed Drizzle's migration reader. A changed migration inventory fails closed pending review. LOCAL ONLY: it adds `mutation_receipts` and a partial dispatch `(org_id,shipment_id)` unique index for nonblank shipment IDs after duplicate preflight. Neither supplement is an accepted production migration or upgrade test.

All real configs use `tests/local-isolated/setup.ts`. Omitted opt-in/credential file fails before app imports. Setup checks actual Pool and HTTP identity; randomizes JWT signing; replaces the test-facing DATABASE_URL with the exact nonsecret disposable URL; uses fresh PGPASSWORD for Pool authentication and injects the same credential only into guarded local HTTP headers. This preserves existing passwordless URL safety assertions without editing tests or enabling trust authentication.

The SDK fetch hook and global fetch allow only the exact loopback SQL endpoint and disposable connection. External fetch-based notifications and redirects are blocked. The WS callback allows only the disposable host/port. This is a trusted-test harness, not a sandbox for arbitrary malicious code using raw sockets or replacing global guards. Do not use default `npm test`, dotenv, or production credentials.

## Cleanup

Stop the exact bridge process first. Then, with the same explicit opt-in and scratch credential path:

```bash
node tests/local-isolated/cleanup.cjs                  # verified-label dry run
PRO_ERP_LOCAL_STOP=1 node tests/local-isolated/cleanup.cjs
```

Cleanup validates the exact resource names/task labels before removing only those Docker resources. Do not stop Docker or unrelated containers. Delete only your own generated scratch credential file after resources are stopped; do not transfer it in a handoff. Cleanup removal must be checked by the operator; only its dry-run branch was exercised during this task. Current process/container handles and actual test results are in `handoff/2026-10-09/local-test-infrastructure.txt`.
