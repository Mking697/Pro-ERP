@AGENTS.md

# Pro ERP

Custom ERP with Google Sheets as the database and Google Drive as file storage — built with Next.js (App Router), Tailwind CSS, and Shadcn UI, deployable for free on Vercel. Full setup instructions, sheet schemas, and architecture notes live in [README.md](README.md) — read that before making changes.

## Status

**Done:**
- **Module 1 — Auth**: custom email/password login against the `Users` tab, JWT session in an httpOnly cookie, role-based route guards (`src/proxy.ts`, `src/lib/auth/`).
- **Module 2 — Admin**: user management (`/admin/users` — create, edit role/status, reset password), Google Sheets & Drive connections UI (`/admin/settings` — paste a URL, header rows auto-create on first write).
- **Module 3 — Task Delegation**: one-time task assignment (`/tasks`) with Priority, Completion date & time, optional Drive attachment, optional completion-proof upload.
- **Module 4 — Dashboard & MIS**: per-user (`/dashboard`) and team-wide (`/performance`) MIS scoring (Done on Time / Delay Done / Not Done), computed dynamically from timestamps — nothing is a stored status flipped by a background job.
- **Module 5 — WhatsApp (ChatXFlow)**: token/phone/base-URL configured from Settings, completion-confirmation + pending-reminder automations, daily Vercel Cron (`vercel.json`).
- **Module 6 — Inward FMS & IQC**: inward entry form (`/inward`), IQC quality-check modal, routing to Failure Log / IMS Inward sheets on save.
- **Recurring Task Engine**: `Recurring_Tasks` + `Holiday_List` sheets, daily cron (`src/lib/recurringGenerator.ts`) generates dated occurrences per rule (D/W/15D/M/Q/Y), holiday-aware for every frequency, month-end-safe.

**Not done yet / next up:**
- Deployment to Vercel — env vars, `CRON_SECRET`, production smoke test.
- Real end-to-end testing against live Google Sheets + Drive + ChatXFlow credentials (so far only type-checked/linted/built, not run against real data).
- No UI to pause/deactivate a recurring rule yet — manual `Status` edit in the `Recurring_Tasks` sheet only (see README).
- No in-app view of the Failure Log / IMS Inward sheets — data lands there correctly, nothing reads it back yet.
- Drive uploads capped at 4MB (Vercel Hobby body-size limit) — fine for images/PDF/Excel, not large video.

## Working notes for future sessions

- All Google API calls happen only inside `src/app/api/**` route handlers and server components — never in client components; the service account key must never reach the browser.
- Every business sheet (Tasks, Inward & IQC FMS, Failure Log, IMS Inward, Recurring Tasks, Holiday List) is its own separate Google Spreadsheet, connected by pasting its URL in `/admin/settings` — not a hardcoded env var. Only the System spreadsheet (`Users` + `Settings` tabs) is env-configured, via `GOOGLE_SHEET_ID`.
- `src/lib/moduleSheets.ts` is the shared resolve/append/update/`recordToRow` layer every domain module (`tasks.ts`, `inward.ts`, `recurringTasks.ts`) is built on — extend it rather than re-implementing sheet I/O per module.
- Before/after any change: `npx tsc --noEmit`, `npm run lint`, `npm run build` should all stay clean.
