# Five-vector security regression audit — 2026-10-22

Audited baseline: `a34ff83`. Authorized local testing only; no production customer data or live production mutation requests. Persistence is substituted in domain/route tests; upload tests use real files in an isolated Hermes scratch directory. Transaction serialization tests model the existing tenant lock; they are **not** a live PostgreSQL concurrency test. No migration or dependency change.

## Results

| Vector | Honest disposition and evidence |
| --- | --- |
| CSV formula injection (CWE-1236) | The six explicitly requested ASCII prefixes (`= + - @ TAB CR`) were **already safe**, including the real `downloadCsvClientSide()` path. Additional OWASP-listed LF/full-width prefixes were **proven and fixed**: five desired-escaping tests fail against baseline and pass after escaping. Typed numeric `-500` remains numeric; string `"-500"` receives an apostrophe. Separators/quotes round-trip without creating a second cell. |
| Upload spoofing (CWE-434) | **Proven and fixed.** Both storage entry points previously wrote an MZ/PE executable named `.jpg`/`.pdf`, and the actual multipart route returned 200 for spoofed content. Tests now require rejection/no disk writes, and multipart 400. Shared validation requires supported MIME, extension and magic bytes. PNG/JPEG/PDF and supported image/video/Excel signatures are explicit rather than wildcard MIME acceptance; PNG/WebP logos remain supported. These are format-identification checks, not antivirus or full document/polyglot validation. |
| Financial number abuse (CWE-20/CWE-682) | **Proven and fixed where missing.** Direct orders accepted infinite rates/absurd quantities; GST was clamped instead of rejected; quotations clamped negatives/NaN to zero; indent PO prices and GST were unchecked; general PO upper bounds/GST were unchecked; forex allowed absurd rates/products. Tests call actual server write services, reject negative qty/rate, Infinity, NaN and `1e20`, and assert no writes/payments/GL. Historical quotation lines are revalidated during order intake. Existing negative/nonfinite payment and invoice checks were already effective; invoice `finalValue` still uses its existing remaining-order-value cap. |
| Payment/bulk double submit (CWE-362) | **Proven and fixed at the client gap.** Two actual same-tick client handlers issued two unkeyed POSTs; the real unkeyed payment route creates two payment/GL rows in the local persistence harness. Existing keyed payment receipts were already safe. UI now uses synchronous refs and one stable key per URL+payload, retaining it after unknown outcomes and rotating after confirmed success/changed payload. Five bulk routes now consume keys and use durable tenant receipts; repeated keyed calls return the same DTO with one activity. Failed bulk rows/payloads remain selected for retry. Bill-payment UI is covered too. |
| Login/API-key brute force (CWE-307) | **Partly already safe, real gaps proven and fixed.** Login already throttled 11 identical IP+email attempts; rotating either axis bypassed that compound bucket. Independent IP and normalized-email limits now close it (10/5 min). API-key valid traffic already had 300/min limiting, but missing credentials/rotating invalid guesses bypassed useful throttling and raw keys appeared in limiter storage. Invalid responses now share a 10/min IP bucket. A separate 300/min/IP admission limit is enforced BEFORE verification, so rotating guesses cannot continue unlimited verifier work; a 350-guess test observes exactly 300 verifier calls. Valid-key usage remains separately 300/min across IPs with a SHA-256 bucket fingerprint. All throttles include Retry-After. |

## Financial policy

- Quantity: finite, at most `1e9`; positive for order/PO demand, zero remains permitted for quotation drafts.
- Rate/amount/document or converted total: finite, nonnegative, at most `1e12`; payments must remain positive after rounding.
- GST: finite, 0–100, rejected rather than silently clamped at server boundaries.
- Exchange rate: finite, positive, at most `1e6`; persisted rounded rates must also remain positive.
- Products and aggregate totals are checked as well as operands. Failures preserve domain error classes.

These are deliberately generous application limits that keep paise/milli-quantity arithmetic below JS safe-integer limits; PostgreSQL numeric columns themselves are unbounded.

## Reproduce RED and GREEN without stashing anyone's work

```sh
# Desired assertions against the original source; EXPECT exit 1.
SECURITY_BASELINE=1 node node_modules/vitest/vitest.mjs run --config tests/security-vectors.unit.vitest.config.ts
# Current implementation; EXPECT exit 0.
node node_modules/vitest/vitest.mjs run --config tests/security-vectors.unit.vitest.config.ts
```

The read-only Vitest loader uses `git show a34ff83:<path>` for baseline source. It never resets, stashes or replaces the working tree. The TSX harness executes production event closures with React/network boundaries substituted; it is not an installed-browser/Excel end-to-end test.

Observed differential result: **baseline 44 failed / 20 passed; fixed 64 passed / 0 failed** across six security test files. Separate test-first runs also demonstrated direct-order, historical-quotation-intake and forex-product failures before their fixes.

Required regression configs were rerun: orders **74**, finance **48**, currency **20**, API access **22** tests passed. Additional forex **13** and receipt-domain **59** tests passed. Combined: **300 passing tests** in these suites.

## Verification caveats

- TypeScript, lint (zero errors; six existing warnings), and i18n checks passed.
- The shared `D:/Pro-ERP` checkout's default build repeatedly hit the Windows/Turbopack `leaflet.css` child-process `0xc0000142` panic. A pristine detached scratch baseline with copied dependencies and the same ignored environment file built successfully; therefore the identical panic was **not** reproduced on that baseline. No shared-tree stash/reset was used.
- A clean detached snapshot containing only the staged security patch also completed `npm run build` successfully. This separates security-patch compilation from unrelated concurrent edits/workspace behavior rather than claiming an unproven clean-tree panic.
- Idempotency keys are kept for a mounted form/action instance, not across reload/unmount. Unkeyed API calls intentionally retain no replay guarantee; integrations must send a stable Idempotency-Key. A changed payload denotes a new logical action.
- Rate limiting assumes a trusted reverse proxy supplies the client IP; it is not distributed-attacker protection.
- CSV apostrophe escaping is for initial spreadsheet opening, not a universal promise after saving and reopening. OWASP's official `www-community/pages/attacks/CSV_Injection.md` lists LF/full-width prefixes and the re-save caveat.
