# Pro ERP

Multi-tenant SaaS ERP — Next.js (App Router), Tailwind CSS, and Shadcn UI, self-hosted on a VPS (Hostinger) behind Nginx + PM2. A self-hosted **Postgres** database via **Drizzle ORM** backs every organization; every tenant-scoped table carries an `org_id` column and every query is scoped through `getTenant()`/`getTenantOrgId()` (`src/lib/tenant.ts`). Attachments go to **local disk** on the app server (`src/lib/storage.ts`), served back out by Nginx.

> **This app used to run on Vercel + Neon + Vercel Blob.** It was migrated to a self-hosted Hostinger VPS on 2026-10-10 — app process (PM2), Postgres (local), and attachment storage (local disk) all moved off those platforms, and the Vercel/Neon projects were deleted. The Postgres driver (`@neondatabase/serverless`) is still the Neon-flavored one for historical reasons; it's pointed at a local proxy sidecar instead of Neon's cloud (see `src/db/local-proxy.ts` and the "Infra migration" section of **[CLAUDE.md](CLAUDE.md)**). If you find a doc, comment, or script anywhere that still assumes Vercel/Neon/Vercel-Blob as the live deployment target, it predates this migration and is wrong — fix it in place. Same standing rule for the older **Google Sheets** architecture, removed 2026-09-16–19. **[CLAUDE.md](CLAUDE.md)** is the actively maintained, detailed architecture/history doc; this file is the shorter "how do I run this" guide.

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
| Database | Self-hosted Postgres on the app VPS, via Drizzle ORM (`drizzle-orm/neon-http`/`neon-serverless`, pointed at a local proxy sidecar — see `src/db/local-proxy.ts`) |
| File storage | Local disk on the app server (`src/lib/storage.ts`), served by Nginx at `/uploads` |
| Auth | Custom email/password (bcrypt), JWT session in an `httpOnly` cookie (`jose`) |
| PDFs | `@react-pdf/renderer` (Quotations, Purchase Orders, Payslips) |
| WhatsApp | ChatXFlow (per-org API token) |
| Tests | Vitest, against a real throwaway org in the live database |
| Deploy | Self-hosted VPS: `git pull` + `npm run build` + PM2 restart, behind Nginx (TLS via Certbot) |

## Local setup

1. **Get a Postgres database.** Any Postgres 14+ works — the production deployment is a plain self-hosted instance on the same VPS as the app. [Neon](https://neon.tech) also still works if you'd rather use managed Postgres (the driver supports both; see `DB_LOCAL_PROXY_URL` below for self-hosted).
2. **Copy the env file** and fill it in:
   ```bash
   cp .env.example .env.local
   ```
   At minimum you need `DATABASE_URL` and `JWT_SECRET` — the app will not boot a single page without `DATABASE_URL`, login included. If your Postgres is self-hosted (not Neon), you also need `DB_LOCAL_PROXY_URL` pointed at a running `local-neon-http-proxy` sidecar (see [Environment variables](#environment-variables) and CLAUDE.md's "Infra migration" section for the full setup). See [Environment variables](#environment-variables) below for the full list.
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
| `DATABASE_URL` | **Yes** | A Postgres connection string (self-hosted or Neon). The app cannot render any page without it. |
| `DB_LOCAL_PROXY_URL` | Yes, for a self-hosted (non-Neon) Postgres | Points `@neondatabase/serverless` at a local `ghcr.io/timowilhelm/local-neon-http-proxy` sidecar instead of Neon's cloud data-proxy. Unset = normal Neon-cloud driver behavior. See `src/db/local-proxy.ts`. |
| `JWT_SECRET` | **Yes** | Any long random string — `openssl rand -base64 32`. Signs the session cookie. |
| `UPLOADS_DIR` | Yes, for attachments | Absolute filesystem path to write uploads into (e.g. `/opt/pro-erp-data/uploads`). Without it, no upload (attachments, logos, PDFs) works. |
| `PUBLIC_UPLOADS_BASE_URL` | No | Public base URL your reverse proxy serves `UPLOADS_DIR` back out at. Defaults to the relative path `/uploads`. |
| `PLATFORM_ADMIN_EMAILS` | No | Comma-separated emails allowed to see `/platform` (every organization on this install, suspend/delete, server error log). Deliberately an env var, not a role or database column — see `CLAUDE.md`'s working notes for why. Empty means nobody has platform access. |
| `CRON_SECRET` | No, but needed for scheduled jobs | Any long random string; trigger the cron route with it as a header from system cron (or any scheduler) on a self-hosted deploy. A request carrying it runs a daily job (recurring tasks, leave activation/reversion, WhatsApp reminders) for every active organization; the same route triggered from the UI runs only for the signed-in admin's own org. |

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

Self-hosted on a VPS (currently Hostinger): `git pull origin main`, `npm install`, `npm run build`, `pm2 restart pro-erp --update-env`, behind Nginx (reverse-proxies to `localhost:3000`, serves `/uploads` as static files, terminates TLS via Certbot/Let's Encrypt). There is no CI/CD auto-deploy step yet — a deploy is a manual SSH session running those four commands in order. Add the same environment variables from `.env.local` to the VPS's `/opt/apps/pro-erp/.env` (see `.env.example`). Scheduled jobs (recurring tasks, leave, WhatsApp reminders) need a system cron entry calling the cron route with `CRON_SECRET` as a header — there is no Vercel Cron anymore. `GET /api/health` reports the live commit hash and which env vars are configured (without exposing their values) — useful for confirming a deploy actually landed — and separately reports real database READINESS: a 2500ms-bounded `select 1` and exact ordered applied migration hash/timestamp comparison against packaged build metadata, returning HTTP 503 for absent configuration, an unavailable/timed-out database, or missing/stale/divergent migration lineage, and 200 only for an exact match. Public failures use stable error codes, never raw database diagnostics; timers are cleared, and a timeout aborts the in-flight HTTP request via a real `AbortSignal` (the route talks to `@neondatabase/serverless`'s `neon()` directly rather than through the shared drizzle client, specifically because only that layer forwards a signal into the actual `fetch()` call) — note this still can't force a query that has already reached Postgres itself to stop executing server-side, since no HTTP-layer client can do that. Regenerate `src/lib/expected-migration-lineage.ts` after SQL/journal changes and run the DB-free freshness gate documented in `handoff/2026-10-09/third-qa03-qa04-health-lineage-complete.txt` before building. It does not prove disaster-recovery/backup-restore capability — that remains a separate, infrastructure-access-requiring exercise.

## Where to look next

- **[CLAUDE.md](CLAUDE.md)** — the living architecture doc: every module, every non-obvious design decision and the reasoning behind it, a running "what's next" list, and working notes future sessions rely on. Read this before making any non-trivial change.
- **[docs/INVENTORY-PPC-PLAN.md](docs/INVENTORY-PPC-PLAN.md)** — the original design spec for Inventory/BOM/Production Planning, still the source of truth for that subsystem's decisions.
- **`/guide`** inside the running app — the in-app Guidebook, written for a non-technical user, covering every feature in plain language (Hindi and English, kept in parity by `npm run i18n:check`).
