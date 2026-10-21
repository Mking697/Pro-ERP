# Phase 2 checkpoint — 2026-10-21

Approved sequence: item 10 subscriptions, item 7 integrations, item 8 scanning. Email remains deferred. Payroll/multi-company are outside this confirmed sequence.

## Item 10: implemented locally, NOT accepted or enabled in production

Initial implementation commit 477928c was pushed and migration 0037 was applied to production, but its build was not deployed. Review found correctness problems; subsequent repairs are uncommitted locally. Do not treat the initial commit as production-ready.

Local repairs include durable subscription reservations/history, unique open attempt per org, provider-bound captured-payment/paid-invoice checks, monotonic paid-through, receipt uniqueness, suspension preservation, fail-closed subscription opt-in, restored one-time Checkout UI, expired Admin login to billing, subscription expiry admission, public portal/exact webhook proxy exemptions, and billing tenant deletion cascade.

Migration 0038_futuristic_gabe_jones.sql is generated and rehearsed locally, NOT applied to production. Expected migration lineage includes production-recorded 0037 and the release's journal/hash for 0038; verify 0038 against the real production ledger after authorized deployment.

Parent-executed verification:
- vitest.billing.config.ts: 46 passing backend unit tests (includes expired-trial Standard Checkout recovery, conflicting subscription rejection and suspension admission).
- vitest.billing-boundaries.config.ts: 51 passing boundary/health/cascade unit tests.
- scripts/verify-billing-postgres.mjs: all checked-in SQL applied successfully to an empty network-isolated PostgreSQL container; real open-attempt/provider/payment uniqueness, receipt/entitlement rollback, advisory lock contention and child-first scoped deletion passed.
- npm run build: background process proc_3edc53c5c59e exited 0 (including cache compaction).
- npm run lint: zero errors; existing unrelated tests/leave-reassignment-atomicity-unit.test.ts warning remains.
- node scripts/i18n-check.mjs: clean, zero new debt.

Evidence boundaries:
- PostgreSQL harness exercises actual SQL, not the application's Neon proxy/transaction transport or real Razorpay.
- No real/provider sandbox subscription was created or charged during this repair.
- Merchant webhook setup is through Razorpay Dashboard; setup script now performs offline validation only.
- RAZORPAY_SUBSCRIPTIONS_ENABLED must remain false/unset until Dashboard setup, configuration and sandbox lifecycle acceptance are separately approved and verified.
- Production last observed database reachable but /api/health ready:false SCHEMA_DIVERGENT because 0037 is applied while old build still runs. Local lineage repair is not a production fix until deployed.

## Remaining engineering/acceptance before item 10 closes

1. DONE locally: Standard Checkout now uses live Admin billing ownership for expired-trial recovery, admits purchases only for Active organizations, checks open subscriptions server-side, and serializes verification/idempotency reads under the tenant transaction. Latest focused/full unit suites, typecheck/lint/i18n passed; final rebuild proc_d55ac7922d80 also exited 0 after these edits.
2. Surface reserved/reconciliation attempt state in billing status so ambiguous creation cannot look like no subscription; define operator reconciliation procedure (no blind retry).
4. Review/re-run current complete diff, typecheck/build after any additional edits, and application-driver/browser acceptance on an isolated DB.
5. Obtain explicit deployment approval. Commit/push only task-owned paths, excluding unrelated marketing changes. Deploy with subscriptions disabled; take backup, apply 0038, verify ledger hashes, build/restart and health/anonymous portal/webhook/billing smoke tests. Preserve unrelated VPS lockfile change; inspect/remove only task-owned temporary migrator.
6. Secure Dashboard configuration and authorized sandbox checkout/charge/replay/cancel lifecycle, including scheduled cancellation UX. Only then consider production enablement with separate owner approval. No real-money transaction authorized.

## Items 7 and 8

Not started. Clarify exact bounded item 7 interface (recommended first slice Tally-compatible Accounts export/read-only integration) against current source before implementation. Item 8 follows its acceptance. Do not label Phase 2 complete.
