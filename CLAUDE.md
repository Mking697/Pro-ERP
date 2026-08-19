@AGENTS.md

# Pro ERP

Multi-tenant SaaS ERP with Google Sheets as the database and Google Drive as file storage — built with Next.js (App Router), Tailwind CSS, and Shadcn UI, deployable for free on Vercel. Any organization signs up, pastes its own Sheet URLs / Drive folder / ChatXFlow credentials, and gets an isolated system. Full setup instructions, sheet schemas, and architecture notes live in [README.md](README.md) — read that before making changes.

## Status

**Done:**
- **Module 1 — Auth**: custom email/password login against the `Users` tab, JWT session in an httpOnly cookie, role-based route guards (`src/proxy.ts`, `src/lib/auth/`).
- **Module 2 — Admin**: user management (`/admin/users` — create, edit role/status, reset password), Google Sheets & Drive connections UI (`/admin/settings` — paste a URL, header rows auto-create on first write).
- **Module 3 — Task Delegation**: one-time task assignment (`/tasks`) with Priority, Completion date & time, optional Drive attachment, optional completion-proof upload.
- **Module 4 — Dashboard & MIS**: per-user (`/dashboard`) and team-wide (`/performance`) MIS scoring (Done on Time / Delay Done / Not Done), computed dynamically from timestamps — nothing is a stored status flipped by a background job.
- **Module 5 — WhatsApp (ChatXFlow)**: token/phone/base-URL configured from Settings, completion-confirmation + pending-reminder automations, daily Vercel Cron (`vercel.json`).
- **Module 6 — Inward FMS & IQC**: inward entry form (`/inward`), IQC quality-check modal, routing to Failure Log / IMS Inward sheets on save.
- **Recurring Task Engine**: `Recurring_Tasks` + `Holiday_List` sheets, daily cron (`src/lib/recurringGenerator.ts`) generates dated occurrences per rule (D/W/15D/M/Q/Y), holiday-aware for every frequency, month-end-safe.
- **Module 9 — Guidebook** (`/guide`, `src/lib/guide.ts`): the in-app manual, written as data. Every section declares its audience (`everyone` / `admin` / `platform` / a module grant) and `guideFor()` filters to the viewer — a doer never scrolls past sheet-connection steps, an Admin gets the full setup walkthrough. Add content by editing `GUIDE`, not by writing a page.
- **Module 8 — Recurring rule pause, quality records, platform console**: recurring rules can be paused/resumed from `/tasks` → Recurring Rules (only `Active` rules generate); Failure Log and IMS Inward are readable at `/inward`; `/platform` lists every organization and can suspend one.
- **Module 8 — Per-user module access**: `Module_Access` column on the Users tab + `src/lib/moduleAccess.ts`. Role stays the privilege level (only Admin manages users/connections); grants decide which modules a person works in. An Admin ticks boxes per user; the grants are baked into the JWT at login so `requireModule()` costs no sheet read. Admins hold every grant implicitly.
- **Module 7 — Multi-tenancy (SaaS)**: self-serve org signup (`/signup`) + onboarding wizard (`/onboarding`). Each organization owns its own System spreadsheet; a platform registry sheet (`PLATFORM_SHEET_ID`) maps orgs and routes login by email. Every sheet read/write, cache entry, and cron run is scoped to one tenant.

**Verified end-to-end against live Google Sheets (2026-08-19)** — two organizations created through `/signup`, module sheets connected, and every flow exercised with real data: task assign → complete → MIS score (50%, matching the formula), recurring rule → generated occurrence, inward → IQC → simultaneous Failure Log + IMS Inward routing, cron under `CRON_SECRET` (idempotent on re-run). Tenant isolation confirmed by interleaved requests from two orgs: users, connected sheets, Drive folder, tasks, and ChatXFlow tokens all stayed separate, and a cross-tenant direct-ID request resolved against the caller's own sheets.

**Live** at https://pro-erp-chi.vercel.app (Vercel, `Mking697/Pro-ERP` → auto-deploys on push to `main`). Production smoke test passed 2026-08-19: logins for three users across two orgs, all six pages, real task/user data, tenant isolation, module-access denials, and cron auth. `GET /api/health` reports the live commit and which env vars are set.

**WhatsApp (ChatXFlow) verified end-to-end 2026-08-19**, on localhost and production: test message, pending-task reminders, task-completion confirmation, and the `CRON_SECRET` all-orgs path. ChatXFlow accepts phone numbers both with and without a leading `+`, so the `+91…` form stored in the Users tab works. In the all-orgs cron run one organization failing (no Tasks sheet connected) did not stop the others — per-org isolation in `forEachActiveOrganization` confirmed against live sends.

**Not done yet / next up:**
- **Attachment storage is hybrid** (`src/lib/storage.ts`). A service account has **zero Drive storage quota**, so uploading into a folder in anyone's *personal* My Drive fails with 403 "Service Accounts do not have storage quota" — even when the folder is shared and `canAddChildren` is true. Confirmed against a live folder 2026-08-19. Requiring a Shared Drive would leave every free-Gmail organization without attachments, so:
  - Org connected a **Shared Drive** folder → files go to its own Drive.
  - Otherwise (or if a Drive upload fails at runtime) → **Vercel Blob**, keyed `orgs/<orgId>/…` so tenants cannot collide. Needs `BLOB_READ_WRITE_TOKEN`, which Vercel injects once a Blob store is connected to the project.
  - Connecting a Drive folder runs a real upload-and-delete probe (`verifyDriveFolderWritable`), so an org learns at setup that a personal-Drive folder will not work — not later, when a user tries to attach a file.
  - **Verified on production 2026-08-19**: an org with a personal-Drive folder fell through to blob without losing the file, an org with no Drive folder went straight to blob, and both uploaded files fetched back as the exact bytes. Blob store `pro-erp-attachments` (Public, region bom1) is connected to the project; `GET /api/health` reports `blobStorage`.
- **Sheets API quota is the platform's scaling ceiling** — every tenant shares one service account, so one Google Cloud project's per-minute limit is split across all organizations. Mitigated (batch reads, retry/backoff, per-org caches, sequential cron) but not removed; measure it before onboarding many paying orgs.
- No billing — every org is created on the `Free` plan and nothing enforces plan limits.
- Drive uploads capped at 4MB (Vercel Hobby body-size limit) — fine for images/PDF/Excel, not large video.

## Working notes for future sessions

- All Google API calls happen only inside `src/app/api/**` route handlers and server components — never in client components; the service account key must never reach the browser.
- Every business sheet (Tasks, Inward & IQC FMS, Failure Log, IMS Inward, Recurring Tasks, Holiday List) is its own separate Google Spreadsheet, connected per organization by pasting its URL in `/admin/settings` — not a hardcoded env var. The only env-configured spreadsheet is the platform registry, via `PLATFORM_SHEET_ID`; each organization's own System spreadsheet (`Users` + `Settings` tabs) is recorded in that registry at signup.
- **Platform-operator access is `PLATFORM_ADMIN_EMAILS`, never a role or a sheet column.** An organization Admin already reaches code that writes to the registry, so a stored flag could be granted to oneself. `/platform` returns 404 (not 403) to everyone else, so its existence is not advertised. An empty list grants nobody.
- Suspending an organization takes effect on its next request — `tenantFromOrgId` refuses a non-Active org — and deletes nothing.
- **Tenant isolation rules** — the three that matter, because breaking any one leaks customer data:
  1. `src/lib/googleSheets.ts` holds raw primitives that always require an explicit spreadsheet ID. `src/lib/tenantSheets.ts` wraps them and resolves the current org. Never add a "default spreadsheet" fallback to the raw layer.
  2. `getTenant()` (`src/lib/tenant.ts`) throws when it cannot resolve an org — an explicit `runWithTenant()` context wins, otherwise the session cookie decides. It must never guess.
  3. Anything read out of a tenant's sheets caches through `tenantCached(orgId, ...)`, never plain `cached()` — a warm serverless instance serves many orgs, and `Settings` holds each one's ChatXFlow API token.
- **`src/proxy.ts` must let self-authenticating API routes through.** Vercel Cron calls `/api/cron/*` and `/api/whatsapp/send-reminders` with an `Authorization` header and no cookie; when the proxy guarded them, every scheduled run was silently redirected to `/login` and never executed. Those routes check `CRON_SECRET` or an Admin session themselves — verified by real requests, not just by reading the code.
- Cron routes carrying `CRON_SECRET` run for every organization via `forEachActiveOrganization()` (`src/lib/platform/runner.ts`, sequential by design so one tenant's burst cannot 429 the rest); the same routes triggered by an admin session run only for that admin's org.
- Adding a column to `USERS_HEADERS` is safe: `ensureUsersHeaders()` appends any column the sheet's header row is missing, because `rowsToObjects` matches on the sheet's own header — a new column written without a matching header would be invisible on read.
- All sheet writes use `valueInputOption: "RAW"`. `USER_ENTERED` lets Sheets reinterpret input, which silently stripped the `+` from `+91…` WhatsApp numbers.
- Every signed-in page renders inside `src/components/app-shell.tsx`, which builds its nav from the viewer's own grants. Pages should not hand-roll their own nav.
- `src/lib/moduleSheets.ts` is the shared resolve/append/update/`recordToRow` layer every domain module (`tasks.ts`, `inward.ts`, `recurringTasks.ts`) is built on — extend it rather than re-implementing sheet I/O per module.
- Before/after any change: `npx tsc --noEmit`, `npm run lint`, `npm run build` should all stay clean.
