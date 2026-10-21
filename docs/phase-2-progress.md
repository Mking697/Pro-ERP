# Phase 2 checkpoint — 2026-10-21

Approved sequence: item 10 subscriptions, item 7 integrations, item 8 scanning. Email remains deferred. Payroll/multi-company are outside this confirmed sequence.

## Item 10: safe deployment completed; auto-renew OFF, acceptance incomplete

Initial implementation 477928c was unsafe. Repairs are committed/pushed as 726cb63 and DEPLOYED after explicit user approval with auto-renew OFF. Built in /opt/releases/pro-erp-726cb63 while the old app served traffic; swapped the successful build and restarted ONLY pro-erp. RAZORPAY_SUBSCRIPTIONS_ENABLED=false was explicitly applied to PM2 and saved. Other app processes were unchanged. Deployment is not subscription acceptance.

Local repairs include durable subscription reservations/history, unique open attempt per org, provider-bound captured-payment/paid-invoice checks, monotonic paid-through, receipt uniqueness, suspension preservation, fail-closed subscription opt-in, restored one-time Checkout UI, expired Admin login to billing, subscription expiry admission, public portal/exact webhook proxy exemptions, and billing tenant deletion cascade.

Migration 0038_futuristic_gabe_jones.sql APPLIED to production. Actual migration ledger verified: d031beb4ace1cd0c21f4e98fe3ac1050f2cf8d5fe5689013a49554b51d3f44e5 / 1792573342669. A fresh production dump was restored to a separate preflight database and 0038 rehearsed there before production migration. Backup retained: /root/backups/pro-erp/before-0038-726cb63.dump; old build retained: /root/backups/pro-erp/next-before-726cb63. Task-owned local QA container, VPS preflight DB and temporary migrators were removed; unrelated local marketing and VPS package-lock.json changes preserved.

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
- Production live verified: /api/health HTTP 200 ready:true, matching 0038 lineage (SCHEMA_DIVERGENT resolved). Anonymous invalid /portal token returns the generic invalid-link page, not login. Anonymous webhook POST returns deliberate 503 Subscriptions unavailable, not login. Real Admin browser /billing renders Growth and 4 active users with One-time payment: no automatic debit; authenticated /api/billing/status returns subscriptionsEnabled:false. Production subscription-attempt count is zero. New server log segment contained two destination-stream-closed warnings during navigation, not billing/DB errors; do not claim all logs are error-free.

## Remaining engineering/acceptance before item 10 closes

1. DONE locally: Standard Checkout now uses live Admin billing ownership for expired-trial recovery, admits purchases only for Active organizations, checks open subscriptions server-side, and serializes verification/idempotency reads under the tenant transaction. Latest focused/full unit suites, typecheck/lint/i18n passed; final rebuild proc_d55ac7922d80 also exited 0 after these edits.
2. Surface reserved/reconciliation attempt state in billing status so ambiguous creation cannot look like no subscription; define operator reconciliation procedure (no blind retry).
4. Review/re-run current complete diff, typecheck/build after any additional edits, and application-driver/browser acceptance on an isolated DB.
5. DONE: explicit safe-deployment approval received, commit 726cb63 pushed/deployed with subscriptions disabled; production backup/restore rehearsal, migration, lineage, restart, anonymous and authenticated smoke tests verified. Local final build proc_d55ac7922d80 and VPS build proc_27821d5f0132 both exited 0.
6. Secure Dashboard configuration and authorized sandbox checkout/charge/replay/cancel lifecycle, including scheduled cancellation UX. Only then consider production enablement with separate owner approval. No real-money transaction authorized.

## Items 7 and 8

User explicitly confirmed BOTH: Tally-compatible Accounts export first, then read-only API-key integration. Bounded child currently owns only a pure ledger-master/Journal-voucher XML serializer and DB-free tests (src/lib/accounts/tally-export.ts, tests/tally-export.unit.test.ts, vitest.tally.config.ts), using official Tally docs. Parent owns tenant-gated data read/date range/export endpoint/UI/i18n/review. Actual chartOfAccounts/journalEntries/journalLines and ACCOUNTS_FMS grant inspected. listChartOfAccounts() seeds defaults; avoid that mutating helper in a read-only export GET. No actual Tally import verified. Read-only API and Item 8 scanning not started; Item 8 follows Item 7 acceptance. Item 10 provider gates remain pending separately. Do not label Phase 2 complete.
