# Pro ERP system map v2 — source evidence and verification

Date: **22 October 2026 (IST)**. Repository: `D:/Pro-ERP`. Baseline HEAD: `963f898`.
This is a current-working-tree map, including concurrent uncommitted security/UI edits, **not an immutable release, a production deployment check, or a security certification**. Current definitions/call sites take precedence over older roadmap prose in CLAUDE.md.

## Deliverable and scope

- HTML: `D:/Pro-ERP/marketing/analysis/pro-erp-system-map-v2.html`
- Editable IR: `D:/Pro-ERP/marketing/analysis/pro-erp-system-map-v2.candidate.json`
- All **30 original component IDs and 20 original connection IDs retained**. Updated map: **46 components, 27 connections, 12 evidence/limitation cards**. Original signal-flow preset, trace animation, module regions and connected sales/production/accounts flows retained.
- New sections cover currency/forex, workspace, field service, read-only API, domain events and both consumers, customer portal, and documented VPS topology.

## Evidence matrix (repository-relative paths)

| Topic | Current-source evidence | Interpretation / limit |
|---|---|---|
| Read-only integration API | `src/app/api/v1/{orders,invoices,stock,customers,vendors,dispatches}/route.ts`; `src/lib/auth/apiKeyGuard.ts:32-81`; `src/lib/apiAccess/apiKeys.ts:27-28,59-65,92-115` | Six GET resources, bearer-key auth, hash/revocation and explicit tenant context. No external write API claimed. Rate-limit changes are uncommitted. |
| Pagination | `src/lib/apiAccess/pagination.ts:1-26` | limit/cursor slices already-loaded arrays, default 50/max 200; not DB pagination. |
| Shared event log | `src/lib/events/emit.ts:16-31,40-74`; `src/lib/tasks.ts:136,182`; `src/lib/leave/leaves.ts:203-216,357`; `src/lib/orders/orders.ts` order-status emit call sites; `src/lib/inventory/ledger.ts` movement emit call sites | Four emitted event types; event persistence is separate from delivery and distinct from FMS named hand-offs. |
| HMAC webhooks | `src/lib/apiAccess/webhooks.ts:28-76,210-363`; `src/app/api/cron/dispatch-webhooks/route.ts` | Raw-body HMAC-SHA256 header, order/stock subscriptions, poll cursor and retry records. Host filtering is literal/string-based; DNS/private-resolution and redirect destinations are not secured by this function. Exactly-once not claimed. |
| Notification dispatch + bell | `src/lib/notifications/dispatch.ts:23-174`; `src/components/notification-bell.tsx:31-93`; `src/components/sidebar-shell.tsx:157,225`; `src/app/api/cron/dispatch-notifications/route.ts` | Task -> assignee, leave approval -> approver, order status -> creator; cron writes inbox, UI polls every 30 seconds, not push. Separate real scheduler/delivery acceptance needed. |
| Currency reference | `src/db/schema/currency.ts:4-16,52-83`; `src/lib/currency/currency.ts:19-25,127-217,257-277` | INR/USD/EUR/GBP/AED; append-only manual effective-date rates; INR is authoritative. |
| Document snapshots | `src/lib/orders/orders.ts:864-901`; `src/lib/accounts/accounts.ts:338-355`; `src/lib/purchase/orders.ts:413-432` | Foreign face amount/currency/rate are snapshotted on Order/Invoice/PO creation, not floating balances. |
| Order-payment FX | `src/lib/orders/orders.ts:939-1110`; `src/lib/accounts/ledger.ts:99-104,131-132` | Explicit `faceAmountReceived` compares order snapshot with current configured rate; cash/AR difference -> gain/loss GL 4100/5600. Not vendor settlement, historical payment-date revaluation or a foreign-currency ledger. |
| Workspace | `src/app/dashboard/page.tsx:161-177,421`; `src/lib/userSettings.ts`; `src/lib/onboarding.ts`; `src/components/saved-views-bar.tsx`; Orders/Inventory boards | Per-user widget visibility/reorder and saved filters; onboarding dismissal is per-org. |
| Bulk + FMS help | `src/app/orders/orders-board.tsx:108-314`; `src/app/inventory/inventory-board.tsx:232-265`; `src/components/fms-builder-help.tsx:60-99`; `src/app/fms/fms-template-form.tsx:546` | Eligible per-row order actions/partial outcomes, selected inventory CSV, first-use/reopenable FMS help. Not an atomic bulk transaction. |
| Accounting correction | `src/lib/accounts/accounts.ts:545-631,742-884` | Aging uses issued invoices/order payments, not GL-only aggregation. GST export uses issued invoices/bills and supports manual filing. |
| Payroll correction | `src/lib/payroll/payroll.ts:393-447`; `src/lib/payroll/statutory.ts:1-23` | Opt-in simplified PF/ESI/TDS exists despite stale “no statutory deductions” prose. Embedded FY2024-25 assumptions are not current-rate or compliance approval. |
| Self-hosted infrastructure | `README.md:3-5,23-33,95-97`; `CLAUDE.md:87-101`; `src/db/local-proxy.ts:14-24`; `src/db/client.ts`; `src/lib/storage.ts` | Documented live stack: Nginx -> PM2 Next -> neon-local-proxy -> local Postgres, plus local uploads. Neon driver does not imply managed Neon hosting. No VPS inspection in this task. |
| Pending billing verification | `src/lib/billing/razorpay.ts:24-26`; `src/lib/billing/subscriptions.ts`; `CLAUDE.md:13,26-28,35` | Subscription backend is feature/config-gated; sandbox full lifecycle and credential rotation are documented follow-ups, not reverified status. No live config/credential values were read. |

## Executed artifact verification

Archify **3.0.1**, quality **showcase**:

- `finalize architecture <absolute candidate> <absolute HTML> --quality showcase --json --repo-root D:/Pro-ERP`: **exit 0, ok true**.
- Gates: **validate PASS / deliver PASS / check PASS / browser-check PASS**.
- Schema/composition validation: **9/9 checks, 0 errors, 0 warnings**.
- Browser: containment, readability, viewer chrome and themes pass. Light viewports 1440x900, 1600x1000, 1920x1080, 2048x1320; dark 1440x900 and 2048x1320. Long-map vertical scrolling is explicitly accepted; no horizontal viewport overflow.
- Additional `visual-check --summary --require-provenance`: **exit 0**, all automated checks/captures pass. Dark/light captures inspected; full-height lower-region capture inspected at original-resolution crop. New event fan-out and hosting chain are visible, with no observed clipping in that crop. Existing long-map detours remain; automated route guidance is not a perceptual-quality guarantee.
- Programmatic HTML coverage checks found all six API paths, HMAC/domain event strings, three human notification triggers, five currencies, forex input/limits, workspace and local infra additions; **0 missing terms**.
- All original component/connection IDs checked against `git show HEAD:<candidate>`; preservation assertions pass.
- Candidate and HTML SHA-256 both match finalize receipt.
- Generated HTML scan found **0** credential-bearing URI, private-key, full Razorpay-key or Google-API-key patterns. This is a scoped scan, not proof that an artifact can contain no possible sensitive text. Secret/config files were not read.

Final candidate SHA-256: `d09314ccb6aaa00cf72619bf6dd21b9c35bbd567f3e9505ee228415837a64e15`

Final HTML SHA-256: `9e85f799f7433fafbb41825ec35ebca7db01aea23cb5ea77f13586f7b338706f`

Receipts: same absolute directory and stem, `.finalize.json`, `.finalize-summary.json`, `.delivery.json`, `.browser-check.json`, `.visual-check.json`. Visual evidence: `.visual-check.html`, four `.visual-check.*.png` captures, and `.full-review.png`.

## Limitations / tool issues resolved

- Existing browser receipt embedded an old G-drive ownership binding. Archived it in Hermes scratch, then regenerated current D-drive receipts; final four gates pass. Cross-drive rename was unsupported, so a cross-drive move was used instead.
- Initial layout label-gap/readability failures were repaired in candidate JSON and regenerated; HTML was never hand-edited.
- Installed CLI reports a newer Archify release available; no upgrade/install performed.
- No application/business/security tests, DB access, migration, commit, push or deploy performed. Concurrent app edits were neither modified nor certified by this task.
- Production acceptance still needs an authorized environment: schema/version health, cron entries, real webhook signing/retries, notifications and billing lifecycle. Other explicit product limits include manual GST filing, simplified payroll, no vendor FX/multi-company, deferred email and aggregate upload quotas, memory-based list pagination/search, and real-device camera verification.
