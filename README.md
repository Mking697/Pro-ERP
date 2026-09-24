# Pro ERP

Multi-tenant SaaS ERP — Next.js (App Router), Tailwind CSS, and Shadcn UI, deployable on Vercel. One shared **Neon (serverless Postgres)** database via **Drizzle ORM** backs every organization; every tenant-scoped table carries an `org_id` column and every query is scoped through `getTenant()`/`getTenantOrgId()` (`src/lib/tenant.ts`). Attachments go to **Vercel Blob**.

> **This app used to store data in Google Sheets**, with each organization pasting its own Sheet/Drive URLs. That architecture was fully migrated away and removed on 2026-09-16–19 — no Sheets/Drive code, dependency, or onboarding screen remains. If you find a doc, comment, or script anywhere that still references a "System spreadsheet", `PLATFORM_SHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, or "paste a Sheet URL", it predates the migration and is wrong — fix it in place. **[CLAUDE.md](CLAUDE.md)** is the actively maintained, detailed architecture/history doc; this file is the shorter "how do I run this" guide.

## What it does

An ERP covering the full order-to-cash and procure-to-pay cycle for a small manufacturer, plus the operational modules around it:

- **Sales chain**: Lead → Quotation → Order → PDI (pre-dispatch inspection) → Transport (TMS) → Dispatch → Proof of Delivery.
- **Purchase chain**: Indent → PO Issue → Follow Up → Material Received.
- **Accounts**: Receivables (Invoices), Payables (Bills), a real double-entry General Ledger (Chart of Accounts, Trial Balance, P&L, Balance Sheet), Additional Payments, a Petty Cash book, Credit Notes and Debit Notes.
- **Production**: Inventory & BOM, Production Planning (PPC), Inward & IQC (with an "Under Deviation" concession path and vendor Debit Notes for quality failures).
- **FMS (Flow Management System)**: a generic engine so an Admin can build any other multi-step business process as data (forms, lookups, working-hours-aware TAT, stock-ledger actions, WhatsApp notify), without writing code.
- **People ops**: Task delegation with MIS scoring, Leave (with buddy-based work reassignment), Payroll v1.
- **Platform**: self-serve org signup, per-org user/module-access management, a Platform Admin console (suspend/delete an org, server error log), shareable live reports.

See **[CLAUDE.md](CLAUDE.md)** for the full module-by-module breakdown, every design decision and its reasoning, and a running list of what's still open.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19 |
| Styling | Tailwind CSS 4, Shadcn UI, Base UI primitives |
| Database | Neon serverless Postgres, via Drizzle ORM (`drizzle-orm/neon-http`) |
| File storage | Vercel Blob |
| Auth | Custom email/password (bcrypt), JWT session in an `httpOnly` cookie (`jose`) |
| PDFs | `@react-pdf/renderer` (Quotations, Purchase Orders, Payslips) |
| WhatsApp | ChatXFlow (per-org API token) |
| Tests | Vitest, against a real throwaway org in the live database |
| Deploy | Vercel, with Vercel Cron for daily jobs |

## Local setup

1. **Get a Postgres database.** The easiest path is [Neon](https://neon.tech) (serverless, has a free tier) — create a project and copy its pooled connection string. Any Postgres 14+ works if you'd rather self-host.
2. **Copy the env file** and fill it in:
   ```bash
   cp .env.example .env.local
   ```
   At minimum you need `DATABASE_URL` and `JWT_SECRET` — the app will not boot a single page without `DATABASE_URL`, login included. See [Environment variables](#environment-variables) below for the full list.
3. **Install dependencies and apply the schema**:
   ```bash
   npm install
   npx drizzle-kit migrate
   ```
   This runs every committed migration under `drizzle/` against your database — it's additive and safe to run repeatedly (already-applied migrations are skipped).
4. **Run it**:
   ```bash
   npm run dev
   ```
   Visit `http://localhost:3000` — it redirects to `/login`. There's no seed data; go to `/signup` to create your first organization and admin account.

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | **Yes** | Neon's pooled connection string. The app cannot render any page without it. |
| `JWT_SECRET` | **Yes** | Any long random string — `openssl rand -base64 32`. Signs the session cookie. |
| `BLOB_READ_WRITE_TOKEN` | Yes, for attachments | Created automatically when you add a Blob store to the project in the Vercel dashboard and connect it. Without it, no upload (attachments, logos, PDFs) works. |
| `PLATFORM_ADMIN_EMAILS` | No | Comma-separated emails allowed to see `/platform` (every organization on this install, suspend/delete, server error log). Deliberately an env var, not a role or database column — see `CLAUDE.md`'s working notes for why. Empty means nobody has platform access. |
| `CRON_SECRET` | No, but needed for scheduled jobs | Any long random string, set the same value in Vercel's Cron config. A request carrying it runs a daily job (recurring tasks, leave activation/reversion, WhatsApp reminders) for every active organization; the same route triggered from the UI runs only for the signed-in admin's own org. |

See `.env.example` for the exact, currently-accurate list with inline comments.

## Migrations

Schema lives in `src/db/schema/**`, one file per domain cluster. **Never run `npx drizzle-kit push`** — it's retired (see `CLAUDE.md`'s working notes for the incidents that led to that). The workflow is:

```bash
# after editing a schema file:
npx drizzle-kit generate   # writes a new numbered .sql file under drizzle/ — review it
npx drizzle-kit migrate    # applies it to the database in DATABASE_URL
```

Every migration is a committed, reviewable `.sql` file — this is the audit/rollback story `push` never had.

## Tests and checks

Run these before considering any change done — `.github/workflows/ci.yml` runs the same set on every push/PR:

```bash
npx tsc --noEmit     # typecheck
npm run lint         # eslint
npm run build        # production build
npm run i18n:check   # every Hindi/English string pair and Guidebook section is in sync
npm test             # vitest, against a real throwaway org in the live database
```

Tests need `DATABASE_URL` set (they exercise real code against the actual database via a disposable organization they create and delete themselves — see `tests/*.test.ts`).

## Deploy

Push to `main` (or your default branch) with the repo imported into Vercel — it auto-deploys. Add the same environment variables from `.env.local` in the Vercel project settings (Production + Preview). Vercel Cron entries live in `vercel.json` (daily recurring-task/leave/reminder job). `GET /api/health` reports the live commit hash and which env vars are configured, without exposing their values — useful for confirming a deploy actually landed.

## Where to look next

- **[CLAUDE.md](CLAUDE.md)** — the living architecture doc: every module, every non-obvious design decision and the reasoning behind it, a running "what's next" list, and working notes future sessions rely on. Read this before making any non-trivial change.
- **[docs/INVENTORY-PPC-PLAN.md](docs/INVENTORY-PPC-PLAN.md)** — the original design spec for Inventory/BOM/Production Planning, still the source of truth for that subsystem's decisions.
- **`/guide`** inside the running app — the in-app Guidebook, written for a non-technical user, covering every feature in plain language (Hindi and English, kept in parity by `npm run i18n:check`).
