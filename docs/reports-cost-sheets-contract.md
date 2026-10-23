# Reports and Product / Job Cost Sheets

Approved by the user on 2026-10-23 after source-backed explanation. Local implementation is authorized. No commit, push, production migration or deployment is authorized by this approval.

## Sequence and current state

1. Reports: CODE GATES PASSED — 21 views implemented, parent tests/typecheck/lint/i18n and focused independent re-review passed. Full webpack build now passes; report browser/real-DB acceptance remains an integrated gate.
2. Estimated Product Cost Sheets: IMPLEMENTED; code/review/disposable-DB and full webpack build gates passed. Authenticated browser/mobile/print and release migration gates remain pending.
3. Recorded Job Cost Sheets: NEXT — source-backed bounded design/implementation begins after estimated code gates; integrated acceptance remains open.
4. Integrated acceptance and documentation: PENDING.

Baseline: main at ecd702b; working tree clean before task. Next 16.3.8, React 19.2.8, Recharts 3.10.1, Drizzle ORM. Bundled Next server/client guide has been read. Database defaults must not be assumed disposable. Default Vitest setup enforces an externally supplied disposable target; use explicit DB-free test configs for isolated unit work, never bypass the guard for persistence tests.

## Report inventory / acceptance

All 21 registered reports are in scope, including Maintenance (registered but previously absent from Analytics). Preserve live session, module grants, tenant context, mine/all scope and single-report selective reads. Preserve share rules and never expose cost sheets via public reports implicitly. Match units and financial semantics; report count is not quantity or money. Separate incompatible UOMs or show explicitly labelled entry counts if source lacks trustworthy units. Ordered pipeline stage distributions are not historical conversion funnels.

| ID | Required presentation |
| --- | --- |
| tasks | outcome comparison bars and daily assigned-task trend |
| delegation | doer workload bars and priority comparison |
| recurring | frequency comparison and active/paused summary |
| inward | inward trend and pending/verified comparison |
| iqc | pass/fail comparison with compatible units; rejection reason ranking |
| ims | supplier accepted-material comparison with trustworthy UOM, otherwise honest verified-entry counts; inward trend |
| inventory | status comparison and reorder shortage ranking; do not imply mixed-unit shortages are comparable |
| indents | status comparison and creation trend |
| bom | active-product component counts and version status summary |
| ppc | planned/produced comparison using correctly defined output and plan status; production schedule trend |
| performance | doer score comparison and outcome breakdown |
| leave | leave-type and approval comparisons |
| finished-goods | product stock / reorder comparisons with UOM |
| leads | ordered pipeline-stage distribution and incoming trend |
| orders | status comparison and count/value trend with INR and cancellation semantics explicit |
| pdi | pending/passed comparison and inspection trend |
| tms | shipment stage comparison and creation trend |
| accounts | real invoice/bill amount comparisons; reuse reconciled aging service rather than treating billed totals as outstanding |
| dispatch | delivery status comparison and dispatch trend |
| payroll | chronological monthly net-pay columns and latest earnings/deductions comparison |
| maintenance | downtime ranking and request/status trend, with mine/all and grants enforced |

Choose bars/columns/line/area/stacked comparisons by question. Donuts remain optional for genuine composition, never the default template for every report. Charts need visible labels/units, accessible summaries, honest empty/error states, responsive layout and English-default/Hinglish copy. Existing chart primitive API callers (notably Inventory detail) must not regress. Add behavior tests first and observe RED, implement GREEN; run the existing report integration suites.

## Added user requirement: detailed exports and audited Admin corrections

User added this during implementation on 2026-10-23. This is additional authorized local scope, not delivered behavior:

- Every module report needs an entry-wise table with step outputs and both Excel and CSV export; exports must preserve report grants, tenant scope, mine/all visibility and active filters, and neutralize spreadsheet formula injection.
- Admin must be able to edit module entries including leads. Inventory/accounting/workflow-derived state must use validated domain corrections rather than unrestricted row overwrites; enumerate existing edit paths and missing modules before choosing implementation.
- Record the live Admin identity, timestamp, field-level old/new values, entity/module identity and reason where a domain correction requires one. Audit and correction must commit atomically; read/export audit only under appropriate authenticated grants, never expose passwords/tokens.
- Execute after the current estimated costing slice: inventory report-detail/step-output coverage and current audit primitives, then implement independently verified module slices. Cross-module acceptance is pending; charts alone do not satisfy this added requirement.

## Existing costing facts (not yet new feature behavior)

- Product identity: (orgId, items.sku); BOM snapshots carry productSku, componentSku, qtyPerUnit, UOM, BOM ID/version. Nested BOM explosion is not implemented by the existing production code: Component_Type Product still consumes an Items-master SKU. Do not silently invent recursive material consumption or double count assemblies.
- Purchase PO line oldPrice/newPrice are agreed INR rates; indents link SKU, linkedPlanId, receivedQty and PO ID. General PO lines are free text, carry ordered qty/rate/amount and receivedQty, with header planId.
- stock_ledger records quantities, not historical unit valuation. plan_materials records consumedQty, but start production derives this from BOM per-unit quantity times the entered start quantity. It is not independent measured consumption.
- productionPlans.actualQty is set at production start, not sufficient proof of finished good output. Determine good output from actual output writer(s), linked plan/run and ledger; do not label start quantity produced.
- Existing Purchase Job Costing sums received plan-linked indent purchases plus noncancelled General PO ordered amounts. It misses pre-existing stock consumption and is not full manufacturing actual cost.
- productionPlans.orderNo is free text, not an enforced Sales Order line link. Historical order profit cannot be derived from it.

## Estimated Product Cost Sheet contract

Tenant/SKU-keyed, not product-name-keyed. Support one unit or batch, active BOM selection, material rows with qty/UOM/rate/amount/source/date, direct labour, direct expenses, factory overhead and separately shown commercial allocations. Show manufacturing total, full commercial total and per-unit values. Exclude recoverable taxes; explicit nonrecoverable charges only. No automatic GL postings or inventory revaluation.

Rate precedence: compatible-UOM received purchase's agreed rate (noncancelled eligible source) as of the sheet date, then explicitly approved standard costing rate. Generic Item Rate is not automatically a purchasing rate. Record source ID, date, UOM and currency; no hidden vendor-price/minimum-price guess. Missing/invalid rates mean incomplete totals, never free material. Preserve legitimate explicit zero versus missing. Validate finite nonnegative money/quantities and decimal rounding consistently; no floating-point drift in persisted money. Show provenance and age, not fictitious weighted-average valuation over quantity-only history.

Receipt dating uses each append-only `stock_ledger` In / Indent_Receipt event's timestamp and positive quantity, linked by tenant, reference indent, SKU and UOM through the indent's exact PO line/header. `indents.receivedAt` is overwritten after every partial receipt and is not historical evidence. Keep the PO-line source ID and include the individual event ID in provenance. Missing or ambiguous event identity cannot establish a received-purchase rate; disclose the limitation and use only an explicit approved standard fallback, otherwise remain incomplete. Agreed rates are still PO-line rates, not historical inventory valuation snapshots.

Mutation reconciliation preserves the original serialized intent and idempotency key until an authorized readback resolves it. A valid same-identity newer version proves the accepted mutation advanced, not that its calculation matches the current row. Show a concurrency notice, retain inputs and block new writes until the user explicitly loads the current snapshot (which reauthorizes and replaces inputs). Wrong identity, older version, same-version differences or malformed snapshots remain unresolved; do not use abandonment to hide an unknown outcome.

Draft can recalculate explicitly. Finalized sheet snapshots BOM/version, quantities, rates, allocation inputs, totals and source facts. Finalized revisions are immutable; changes create a revision. Finalize only complete, validated sheets. Server-side permission and tenant checks on pages, CRUD, finalization and exports; concurrency/idempotency rules tested. Use a separate costing grant, not blanket purchase/inventory access. Do not auto-grant to ordinary users; follow existing Admin grant management convention. Include product/BOM entry point, main navigation, English/Hinglish guide and print/Excel export with formula-injection protection. New tables require schema exports, tenant deletion cascade and reviewed additive migration under existing sync discipline. Generated migration is not an applied migration; production lineage comes from actual application, not file timestamps.

## Recorded Job Cost Sheet contract

Read actual plan-linked consumption and actual output with explicit basis labels. Preserve estimated-versus-recorded distinction. Cost existing-stock consumption too, with documented valuation source/date. Historical missing rate snapshots cannot be reconstructed as proven historical actuals: explicit standard-rate valuations stay estimated/provisional.

Separate committed purchase amounts from received/accepted job expenses; classify General PO lines before including them (direct service, factory allocation, commercial cost, excluded/capital asset). Never charge a full capital purchase to a single product by default. No double counting purchased receipts and subsequently consumed same stock. Labour is entered approved hours x costing hourly rate or per-piece rate; do not allocate entire monthly payroll arbitrarily. Factory allocation bases are explicit approved per-unit/labour-hour/machine-hour inputs. Reject duplicate source allocations or cap them to eligible source amount with transaction concurrency protection. Extra issues, returns, scrap/rework and finished good output gaps must be disclosed and tested rather than fabricated.

Initial selling price input is a target for estimated margin only. Actual customer-order profitability needs explicit plan/order-line allocation and is not silently inferred from a name/free-text orderNo. No public cost sharing by default.

## Frozen Estimated Cost Sheet API / ownership

Shared DTOs are `src/lib/costing/types.ts` (parent-owned, client-safe). Monetary and quantity inputs/results are decimal strings, not browser float totals. All routes require the new `COST_SHEETS` grant and validated tenant; Admin obtains the key through existing effectiveModuleAccess behavior, not data backfill. Parent owns moduleAccess, navigation, Product/BOM links, pages/client UI, translations and guides. Backend worker owns costing engine/service/validators, cost schema exports and tenant deletion list, cost API routes and backend tests. Only parent generates migrations, runs final build and closes acceptance. Do not run migration generation while other source/schema writers are active; retain actual preflight blockers.

- `GET /api/cost-sheets/catalog` => `{products: CostProduct[]}` (FG/Semi-FG products and active BOM products; missing BOM explicit).
- `POST /api/cost-sheets/preview` body `CostSheetInput` => `{calculation: CostCalculation}`. No persistence; server fetches BOM/rates, never accepts client totals.
- `GET /api/cost-sheets?productSku=...` => `{sheets: CostSheetSummary[]}` with a documented bounded pagination contract if capped; never truncate costing operands.
- `POST /api/cost-sheets` body `{input: CostSheetInput, supersedesId?: string}` => `{sheet: CostSheet}`. Creates a Draft, including incomplete drafts. A superseded parent must be finalized and of the same tenant/SKU. Product-local revision numbers allocated inside the tenant transaction.
- `GET /api/cost-sheets/[id]` => `{sheet: CostSheet}`.
- `PATCH /api/cost-sheets/[id]` body `{input: CostSheetInput, expectedVersion: number}` => `{sheet: CostSheet}`. Explicit recalculation/update only for Draft; reject stale version and product identity changes.
- `POST /api/cost-sheets/[id]/finalize` body `{expectedVersion: number}` => `{sheet: CostSheet}`. Freeze saved complete snapshot; do not silently reprice. Reject incomplete or stale requests. Idempotent replay must return original accepted DTO.
- `POST /api/cost-sheets/standard-rates` body `StandardCostRateInput` => `{rate: StandardCostRate}`. Explicit approve action under costing grant, append effective-dated audited record, compatible item UOM required. A later record must not rewrite old finalized snapshots.
- `GET /api/cost-sheets/[id]/export` => Excel workbook (XLSX), same tenant/grant and saved snapshot, never recalculate on export. Text cells must not become formulas; safe filenames.
- All mutations use `Idempotency-Key` and existing durable mutation primitives with actor-bound canonical payload; errors `{error: string}` and appropriate 400/401/403/404/409/500 status. Do not leak raw SQL or secrets.
- `src/lib/costing/service.ts` exports `getProductCostSheet(id: string): Promise<CostSheet | null>` for the parent-owned authorized print page; all its reads tenant-scoped. Other service function names are backend-owned.

Charge heads: Labour, DirectExpense, FactoryOverhead, Commercial. Basis Batch applies quantity 1; PerUnit applies batchQty; LabourHours/MachineHours apply explicit quantity. Manufacturing = material + labour + direct expenses + factory overhead; fullCost = manufacturing + commercial; perUnit = fullCost / batchQty. Missing material valuation means material/manufacturing/fullCost/perUnit are null and complete false, while knownMaterialSubtotal and entered expense subtotals remain available. No implicit GST or payroll allocation. No margin feature in this first estimated slice; selling-price/order-profit is retained for later scope, not claimed done.

## Verification record

BUILD GATE PASSED: uninstrumented full `NODE_ENV=production npm run build -- --webpack` (`proc_ceaaf5a000a9`) exited 0; compilation, TypeScript, 194/194 generation, optimization and build traces completed. Parent verified BUILD_ID, prerender/required-server manifests, emitted `middleware.js` and its .nft trace exist; native Neon import is present and the driver is included in that trace. Direct installed NFT tracing of the emitted middleware now passes. This is the webpack build; the default Turbopack command was not rerun or claimed passing. Parent started the actual new production bundle on isolated loopback port 4037: /login returned 200 with form; Cost Sheet page/print/catalog/list anonymously redirected to login. This establishes production startup and anonymous boundaries, NOT authenticated browser/database workflow acceptance. QA listener was stopped by its verified exact PID and port 4037 read back free. No production deployment/migration performed.

Tracer failure localized: in-memory instrumentation identified `.next/server/proxy.js` AST range 367167–367170, in the bundled Neon PostgreSQL error parser's computed property access. Direct `nodeFileTrace` on proxy.js reproduces the exact exception; earlier page/chunk-only probes missed this sibling entry. Parent read installed Next serverExternalPackages docs/handler source, added explicit `serverExternalPackages: ["@neondatabase/serverless"]` to preserve native Node driver loading rather than inlining its parser. Regression observed RED before config change; config + existing proxy-public-boundary suite now 9 tests passed, scoped eslint and full tsc pass. Full uninstrumented production webpack build `proc_ceaaf5a000a9` is still RUNNING after the first 150-second wait; config fix is not yet build-accepted. No vendored dependency edit, tracing disablement or auth/counter removal.

Build root-cause progress: diagnostic one-shot `proc_9b8c7a80fccc` failed again, but full stack locates the exception in Next's bundled `@vercel/nft` static evaluator (`MemberExpression`, `computePureStaticValue`), not an identified application page. Source inspection finds property-key coercion in that evaluator. Direct tracing of Next's server seeds, all current server chunks, and all compiled app JS did not reproduce the failure, including production NODE_ENV; those probes do not resolve the build. Temporary scratch-only in-memory tracer instrumentation is now active in full build `proc_fd695dff9013` to annotate the actual failing input file and AST range. No node_modules or application config changes made; no fix claimed yet.

Latest build continuation: tracked one-shot `NODE_ENV=production npm run build -- --webpack` compiled in 90s and passed TypeScript in 52s, but exited 1 during static generation (0/194) with `TypeError: Cannot convert object to primitive value`; this is still a failing one-shot build. Installed Next error formatter hides dependency frames unless `__NEXT_SHOW_IGNORE_LISTED=true`. Using that diagnostics flag with the production generation-only phase against the same compilation completed 194/194 pages and final optimization, exit 0. No source/config workaround applied. A new tracked full one-shot run with the diagnostic flag (`proc_9b8c7a80fccc`) is active to capture the original failure's full stack; split generation success is not claimed as a fix for the one-shot error.

Focused independent re-review `deleg_a0bf3280` PASSED both previously reported costing defects (no security/logic findings). Reviewer inspected the actual PO/indent/ledger/idempotency writers and ran source/engine plus controller/action regressions. Scope is only these fixes; browser/login, release migration and full product acceptance remain separate gates. Optional follow-up: exercise successive receipts via the real receivePurchaseOrderLine writer, not just equivalent ledger fixtures.

Latest 2026-10-23 parent continuation after two-issue fix: parent re-executed backend/source HTTP units (33 tests), UI/controller/actual-action units (51 tests), and fresh disposable real PostgreSQL suite (5 tests, now including historical partial receipts); all passed. Parent full project tsc, lint (0 errors, 6 existing warnings), i18n and diff checks passed for the fixed functional source. Individual Indent_Receipt ledger events now determine historical rate eligibility; accepted-but-advanced writes expose explicit current-snapshot recovery without duplicate mutations. Focused independent re-review dispatched as deleg_a0bf3280, not yet accepted. Parent added grant-scoped English/Hinglish guide chapters and a guide regression afterward; backend+guide suite now 34 tests across 6 files, passed. No fresh production build/browser acceptance or release migration is claimed. Parent verified costing-QA Docker containers/networks absent after cleanup.

2026-10-23 continuation after provider interruption: parent completed real Cost Sheet HTTP routes and saved-snapshot XLSX export, expanded engine/source tests, and finished integration with the UI worker's files. Parent reran costing backend/unit routes: 26 tests across 4 files passed. Parent reran UI/grant/navigation/controller/actions: 35 tests across 7 files passed. Full-project `npx tsc --noEmit -p tsconfig.json` passed. Full lint passed with the same six pre-existing test warnings; i18n and diff-check passed after canonical English provenance keys were wrapped. Independent review and fresh production build/browser acceptance are still pending; do not mark this slice fully accepted.

Parent executed `PRO_ERP_COSTING_REAL=1 node tests/costing-real-runner.cjs`: all four real PostgreSQL tests passed using the installed Neon HTTP and Pool/WS transports against freshly named, labelled disposable containers. Executed source joins, snapshot readback/finalization, revision repricing without changing finalized history, tenant isolation, concurrent identical replay, unique revisions, forced trigger-failure rollback of business+receipt writes, missing versus approved zero rates, stale versions and revoked costing grant. Cookie/login guard is mocked for these service tests, so they are NOT login/browser acceptance. The runner exports the current schema with `drizzle-kit export` into an empty QA database only; this is NOT release migration generation/application or upgrade-lineage acceptance. Parent read back Docker container/network inventories after cleanup: no costing-QA resources remained.

Real DB acceptance caught and fixed an extra orgId leaking via spread DTO serialization. Integration inspection also caught object-key-order comparisons that fail after PostgreSQL JSONB reordering; a reproduced failing UI regression now passes with structural equality. Purchase eligibility now rejects cancelled indent receipts as well as cancelled POs. Source schema remains additive and tenant deletion coverage passes.

RELEASE MIGRATION BLOCKER: `npm run db:check-sync` failed with database password authentication failure. Do not bypass migration-sync discipline, generate against an unverified lineage, change credentials, or apply production migrations. No new release migration has been generated. Existing migration journal currently has 43 entries through 0042_demonic_hobgoblin. A fresh disposable schema test does not resolve this release blocker.

Still pending in the estimated slice: independent review, bilingual guide chapter, full fresh production build, genuine authenticated browser/print/mobile acceptance and migration-lineage resolution. Recorded Job Cost Sheets and the newly added module-detail/export/audited-Admin-edit scope remain pending, not silently dropped.

2026-10-23: Report worker implemented 21 report views in charts.tsx, Analytics and report queries, with three new DB-free test files and translations. Parent reran `npx vitest run --config tests/report-charts.unit.vitest.config.ts --reporter verbose`: 77 named tests passed across 3 files; reran existing `tests/perf04-perf06.unit.vitest.config.ts`: 34 passed across 10 files. Parent full-project `npx tsc --noEmit -p tsconfig.json`: exit 0. Parent `npm run lint`: exit 0, six warnings in unrelated existing tests. Parent removed exactly 34 resolved Analytics copy-baseline entries (no new allowances); rerun `npm run i18n:check`: exit 0, zero missing/orphan/duplicate keys or new copy debt. `git diff --check`: exit 0.

Build gates remain BLOCKED: default `npm run build` did not complete inside 180s; checked task-owned process afterward and it exited before attempted cleanup (taskkill reported process not found; a subsequent process inspection showed no project Next build/dev/start process). Documented alternative `npm run build -- --webpack` compiled successfully and passed its TypeScript stage, then failed collecting page data with `TypeError: Cannot convert object to primitive value` (exit 1). This is not a successful production build; root cause not yet established. Docker daemon is not running; no disposable database or browser acceptance has been established. No production/database mutations performed.

Independent review completed (deleg_06c1c2de): no security concern found; FAIL for a horizontal-bar zero-baseline regression (`domain=[auto,auto]` can hide the lowest positive or least-negative bar). Accounts aging, PPC empty-state and readable lead-stage labels were also flagged. A third-context fix worker (deleg_b860a918) is active for exactly these items, with RED/GREEN and focused regressions required. Reports remain unaccepted; Cost Sheet implementation has not started.

Build investigation: direct static-config collection succeeded for all 293 compiled App routes, then the actual Next worker transport with 5 workers also passed all 293, both with a nonexistent dummy DB target and with existing application environment loaded privately (no credentials printed, no data queries invoked). This does not reproduce or explain the full-build failure. A generation-only debug-prerender diagnostic completed collection but failed prerendering 38 paths with development/production React mismatch-like errors; it reused a production compilation while debug mode explicitly selected development, so this is not evidence of 38 new app regressions or a valid release build. Do not deploy that diagnostic `.next` output. A fresh full build against the settled source is still required. Root cause of the original page-data failure remains unconfirmed. No production changes or fixture writes performed.

2026-10-23 follow-up: Third-context report fixes implemented. Parent re-executed report-charts suite (94/94), existing perf04/perf06 suite (34/34) and existing perf02/perf03 reports suite (23/23, including real aging-service logic with mocked transport), all passing; full tsc, lint (0 errors, same 6 warnings), i18n and diff-check passed. Parent inspected zero-inclusive numeric XAxis domain and current all-time reconciled aging presentation. No real PostgreSQL/browser acceptance yet.

Build evidence update: `NODE_ENV=production npm run build -- --webpack` freshly compiled the settled source and passed its TypeScript stage, then again failed in page-data collection. Running the documented generation phase separately with `NODE_ENV=production npm run build -- --webpack --experimental-build-mode generate` against that same fresh production compilation completed successfully: collection, 189/189 static generation, final optimization and route manifest (exit 0). `.next/BUILD_ID`, prerender manifest and required-server-files manifest exist. Thus a production compile + separate production generation succeeded; the one-shot build command still fails and its root cause is unresolved. This is not a claim that default `npm run build` passed. No application source/config changes were made to hide the build failure.

Focused independent re-review of the settled fixes is active (deleg_fedd97d0). On a PASS, report implementation/code gates can close with explicit browser/real-DB and one-shot build limitations retained for integrated acceptance; then begin the already-approved Estimated Product Cost Sheet implementation. Do not re-request overall feature approval.
