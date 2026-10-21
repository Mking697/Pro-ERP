# Accessibility audit — October 22, 2026

## Method and limits

Code-level WCAG 2.1 AA review of the requested dashboard, Orders, Inventory, sidebar, FMS builder and NotificationBell surfaces, including shared chart/dialog/checkbox primitives. No live-browser, NVDA, JAWS, VoiceOver or axe verification was performed; the fixes and regression tests do not establish whole-application conformance. Contrast calculations use the repository's default light/dark tokens, OKLCH-to-sRGB conversion and alpha-composited badge backgrounds, including hover states. Custom brand themes, forced colors, zoom/reflow and runtime focus/announcement behavior still warrant browser/assistive-technology checks.

The existing new-order Label/htmlFor and sr-only conventions were retained. Base UI continues to own modal focus containment, Escape and focus restoration. The existing FMS help useSyncExternalStore/localStorage store was not replaced. No dependencies were added.

Line references below identify the accessibility-only commit (not concurrent uncommitted visual/security edits). Before references are from baseline `a34ff83`; after references refer to the resulting source.

## Findings and fixes

| Finding / WCAG criterion | Before | After / exact location |
|---|---|---|
| Repeated dashboard control names — 1.3.1, 4.1.2 | Every widget's up/down arrows and visibility switch had identical names without the widget name. | Names now include the associated widget. `src/app/dashboard/customize-dashboard-dialog.tsx:122,131,139`. |
| Checklist completion conveyed only visually — 1.3.1 | Per-step completion was an aria-hidden tick and strikethrough; the aggregate count did not identify completed steps. | Each link includes an sr-only Completed/Pending suffix. `src/app/dashboard/onboarding-checklist.tsx:93`. |
| Unnamed/placeholder-only FMS controls — 1.3.1, 3.3.2, 4.1.2 | Deadline step/field/offset, custom outcomes, routing, question name/type/options, lookup module/display/autofill, existing source/step and ledger direction/SKU/quantity/UOM had no persistent programmatic label. | Seventeen controls have contextual names using step and, where applicable, question/outcome identity. `src/app/fms/fms-template-form.tsx:691,711,727,767,802,861,875,902,923,942,977,1038,1063,1165,1177,1193,1209`. |
| FMS help focus return and popup state — 2.4.3, 4.1.2 | Help already had an accessible name, but its custom controlled opening path had no explicit return-focus target or popup state. | Existing button now exposes haspopup/expanded and a ref used by DialogContent.finalFocus, including the first-run auto-open path. Decorative icon hidden. `src/components/fms-builder-help.tsx:74,88-90,99,103`. |
| Incomplete select-all state — 4.1.2 | Orders and Inventory checkboxes already had row-specific accessible names; headers only exposed true/false even when some visible rows were selected. | Base UI indeterminate state now conveys mixed selection. `src/app/orders/orders-board.tsx:558`; `src/app/inventory/inventory-board.tsx:409`. |
| Bulk selection changes silent — 4.1.3 | Selection counts were visual text. A live region mounted only with the toolbar would also miss reliable first-selection and clear-to-zero announcements. | Persistent polite, atomic sr-only status regions sit outside the conditional toolbars. `src/app/orders/orders-board.tsx:373-375`; `src/app/inventory/inventory-board.tsx:274-276`. |
| Inventory filter state visual only — 4.1.2 | The active stock-status filter was distinguished only by button styling. | aria-pressed exposes the selected filter. `src/app/inventory/inventory-board.tsx:368`. |
| Unnamed bulk-action form fields — 1.3.1, 3.3.2, 4.1.2 | Bulk action selection, dispatch date and cancellation reason lacked persistent names. | Localized aria-labels name all three controls. `src/app/orders/orders-board.tsx:492,508,528`. |
| Payment/action labels not associated — 1.3.1, 3.3.2, 4.1.2 | Detail dialog date, face amount, amount, payment mode and reference labels were adjacent but lacked htmlFor/id pairs; cancellation reason relied on a placeholder. | Associated visible labels and one sr-only cancellation label. `src/app/orders/order-detail-dialog.tsx:268-269,306-310,404-406,416-417,421-423,436-437`. |
| Notification unread state silent — 1.3.1, 4.1.2, 4.1.3 | The trigger was named only Notifications; unread count and unread dots were visual. | Name includes the exact unread count, a persistent polite/atomic status announces changes, individual unread items include sr-only state, and the duplicate visual count is hidden. `src/components/notification-bell.tsx:133-135,145-149,161,200`. |
| Notification popup mixed menu/button semantics — 2.1.1, 4.1.2 | Raw buttons inside a menu did not participate in Base UI's menu-item arrow-key navigation; Mark all read was nested in the group label. | Registered DropdownMenuItem actions replace raw buttons; Mark all read is outside the label and keeps the popup open. `src/components/notification-bell.tsx:173-179,188-210`. |
| Sidebar lacked navigation bypass — 2.4.1 | Keyboard users had no direct way to skip repeated sidebar/header controls. | First-focusable skip link targets a programmatically focusable main landmark. `src/components/sidebar-shell.tsx:108-110,228`. |
| Collapsed sidebar missing action/link names and state — 4.1.2 | With no uploaded logo the collapsed dashboard link contained only an aria-hidden fallback mark. The profile expansion button was named by one initial, and desktop toggles did not expose expansion state. | Organization/dashboard name on the logo link; action-oriented profile name; aria-expanded on both desktop toggles. `src/components/sidebar-shell.tsx:121,170-171,186-187`. |
| Muted text fails on muted background — 1.4.3 | Default light muted-foreground measured 4.34:1 against muted. | Slightly darker light token reaches 4.84:1 on muted and 5.28:1 on white. `src/app/globals.css:63`. |
| Badge text fails on tinted backgrounds — 1.4.3 | Success reused a chart-fill color; destructive reused its tint color as text. Measuring against white alone missed compositing and muted/hover surfaces. | Dedicated light/dark foreground tokens preserve tint/chart colors. Minimum tested contrast: success 4.51:1, destructive 4.74:1 across light/dark background/card/popover/muted and hover combinations. `src/app/globals.css:157-160,174-176`; `src/components/ui/badge.tsx:18,31`. |
| Focusable charts inside aria-hidden — 2.4.3, 4.1.2 | Bar/timeline accessibilityLayer and PieChart's default layer created focusable SVG roots inside aria-hidden wrappers. Recharts' installed RootSurface source sets tabIndex=0 when the layer is enabled. | Disable the layer on the three visual charts, retaining the established sr-only summaries, visible legends and report tables as accessible equivalents. `src/components/charts.tsx:140,217,313`. |

## Verified existing behavior

- Orders/Inventory row checkboxes already had unique names; no false missing-name finding was filed.
- Order rows already provide a keyboard-reachable details button; intake rows provide Map buttons.
- FMS Help, onboarding dismiss and dashboard info buttons already had accessible names.
- Shared Base UI dialogs have titles/descriptions, modal focus containment, Escape handling and viewport-height scrolling. The mobile navigation already specifies initialFocus and finalFocus; no custom focus trap was added.
- `dashboard/analytics.tsx` already uses shared chart summaries and visible legends/table equivalents; dashboard MIS text uses the existing contrast-adjusted score classes. No unnecessary page/analytics rewrite was made.

## Verification

Added `tests/accessibility-audit.test.mjs` (AST-based source regressions) and `tests/accessibility-contrast.test.mjs` (numeric token/compositing regressions). Each relevant regression was observed failing before its fix. These are source/math tests, not rendered accessibility-tree or screen-reader tests.

The shared D:/Pro-ERP tree was being concurrently edited by other agents. Its initial verification attempts encountered unrelated in-progress type/lint/i18n errors and the Windows Turbopack leaflet.css subprocess crash. To avoid stashing or overwriting sibling work, an isolated detached worktree was created in the Hermes scratch directory, with copied dependencies and only the accessibility hunks applied. The clean baseline production build succeeded there; the accessibility-only production build also compiled and generated all 189 static pages. Typecheck, lint (six pre-existing warnings, no errors), i18n (zero missing translations/new unwrapped strings) and the focused tests passed there. Final command results are recorded in the task response.
