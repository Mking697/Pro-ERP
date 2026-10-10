# PROJECT_ANALYSIS.md — Pro ERP

Source: direct inspection of this repository (`CLAUDE.md`, `README.md`, `src/lib/moduleAccess.ts`,
`src/db/schema/**`, `package.json`) on 2026-10-07. Every claim below is traceable to actual code,
not inferred from naming alone.

## What it is

**Pro ERP** — a multi-tenant SaaS ERP for small/mid-size manufacturers, covering the full
order-to-cash and procure-to-pay cycle plus the operational modules around it (tasks, leave,
payroll, a generic workflow engine). Built by Essor Automations.

## Stack (verified in package.json / CLAUDE.md)

- Next.js 16 (App Router), React 19, TypeScript
- Tailwind CSS 4 + Shadcn UI + Base UI primitives
- Neon serverless Postgres via Drizzle ORM (one shared DB, every tenant table carries `org_id`)
- Vercel Blob for attachments
- Custom email/password auth, JWT session (httpOnly cookie, `jose`)
- `@react-pdf/renderer` for PDF generation (Quotations, POs, Payslips) — no headless Chromium dep
- ChatXFlow for WhatsApp notifications (per-org API token)
- Deployed on Vercel, live at https://pro-erp-chi.vercel.app

## Business purpose

Replaces spreadsheets and disconnected tools for a manufacturer's full operating chain:
**Lead → Quotation → Order → PDI → Transport → Dispatch → Invoice/GST**, plus
**Indent → PO → Follow-up → Material Received** on the buy side, backed by real-time
inventory, BOM-driven production planning, and a no-code workflow engine (FMS) for any other
multi-step process.

## Target users / industries

Small-to-mid manufacturing/auto-component businesses (the live demo org literally named
"Orion Auto Components" in our own seed data mirrors this) needing one system instead of
Excel + WhatsApp + separate accounting software. Multi-tenant: each signup is a new,
fully isolated organization.

## Verified module list (from `src/lib/moduleAccess.ts` + CLAUDE.md, cross-checked against schema)

1. **Auth** — custom email/password, JWT, role-based guards.
2. **Admin** — user management, module-access grants per user.
3. **Task Delegation** — one-time tasks with priority, due date, attachment, completion proof.
4. **Dashboard & MIS** — per-user and team-wide scoring (On Time / Delay / Not Done), 0% best
   / −100% worst penalty scale, computed live from timestamps (not a stored status).
5. **WhatsApp (ChatXFlow)** — completion/reminder automations, FMS step-complete notify.
6. **Inward FMS & IQC** — inward entry, quality check, working-hours-aware TAT, vendor-linked.
7. **Recurring Task Engine** — daily/weekly/15-day/monthly/quarterly/yearly, holiday-aware.
8. **Per-user module access** — granular feature grants layered on top of Role.
9. **Guidebook** — in-app manual, Hindi/English parity enforced by `npm run i18n:check`.
10. **Organization logo** — per-org branding.
11. **Analytics dashboard** — hand-rolled SVG charts, no external charting library.
12. **FMS (Flow Management System)** — the standout differentiator: an Admin builds any
    multi-step business process as **data**, not code — forms, lookups to other modules,
    a working-hours-aware TAT calendar (minutes/hours/days), stock-ledger actions, branching
    outcomes, per-step WhatsApp notify lists. Verified via `src/lib/fms/engine.ts`,
    `calendar.ts`, `dataSource.ts`.
13. **Vendor & Customer Master** — manual add + CSV/Excel bulk import, duplicate warnings.
14. **Purchase** — Indent Approve → PO Issue → Follow Up → Material Received, vendor-first UI,
    PDF generation for POs.
15. **Leave ("buddy system")** — configurable approval chain, and on approval every open
    Task/FMS step for the requester automatically reassigns to a named Buddy, with full
    audit trail and precise reversion.
16. **Lead FMS** — pipeline (New → Qualify → Follow-up/Meeting/Negotiation → Quotation →
    Order Confirmed/Lost), bulk import, per-transition activity timeline.
17. **Order FMS** — two entry paths (lead-sourced, direct), credit-limit/credit-days gating,
    live stock reservation (Free = On Hand − Committed − Reserved), automatic FIFO top-up
    when new stock arrives against shortfalls.
18. **PDI (Pre-Dispatch Inspection)** — Pass/Fail gate before shipment, optional report upload.
19. **TMS (Transport)** — Self vs Party-arranged transport, multi-shipment-per-order support.
20. **Accounts** — real double-entry GL (Chart of Accounts, Trial Balance, P&L, Balance Sheet),
    Receivables (Invoices, multi-invoice-per-order splitting), Payables (Bills, Input GST
    credit), Additional Payments, Petty Cash, Credit/Debit Notes, Receivables Aging,
    GSTR-shaped export report.
21. **Dispatch** — Gate Pass numbering, the one point in the whole Sales chain that writes a
    real stock-ledger "Out", Proof of Delivery.
22. **Payroll v1** — join-date proration, explicitly not statutory (no PF/ESI/TDS yet).
23. **AI Chatbot** — Gemini-backed, tool-gated strictly to the asking user's own module grants
    (never general knowledge, deterministic "I couldn't find that" when no tool found data),
    full audit log at Platform level.
24. **Platform console** — every org on the install, suspend/delete, usage metrics, error log.
25. **Global search (⌘K)** — cross-module command palette (Customers/Vendors/Orders/Items/Leads).

## Unique / visually strong selling points (for the video)

- **The Sales chain is fully modeled end-to-end** — Lead through cash, not just an order book.
- **FMS: a no-code workflow builder** that actually enforces role grants, working-hours TAT,
  and can move real stock — this is the single most defensible, demo-able differentiator.
- **Live, real-time stock math** — Free stock view that accounts for raw-material commitment,
  in-transit, AND order reservation simultaneously, with automatic FIFO top-up.
- **Real double-entry accounting under the hood**, not a bolt-on — GST tracked as a liability,
  Input Tax Credit on the Payables side, auto-posted journal entries from 4 real business events.
- **A WhatsApp-first operational layer** — step completions, shortages, leave approvals all
  reach the right person via WhatsApp without them opening the app.
- **An AI Chatbot that is provably safe** — tool-gated per user's own grants, cannot answer from
  general knowledge, audited.
- **Command palette (⌘K)** — power-user navigation across 5+ modules instantly.
- **Dark mode, collapsible sidebar, mobile-responsive** — looks like a modern SaaS product,
  not a legacy ERP.

## What this is NOT (guardrails for the script/claims)

- Not GST e-filing (report is GSTR-**shaped** for an accountant to file manually).
- Not statutory payroll (no PF/ESI/TDS).
- Not a two-way WhatsApp chat channel (outbound only).
- No clock-in/clock-out attendance tracking.
