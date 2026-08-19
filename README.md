# Pro ERP

Multi-tenant SaaS ERP with Google Sheets as the database and Google Drive as file storage. Built with Next.js (App Router), Tailwind CSS, and Shadcn UI, deployable for free on Vercel.

Any organization signs up, connects **its own** Google Sheets, Drive folder, and ChatXFlow credentials, and gets an isolated system. Every customer's data stays in their own Google account — Pro ERP only reads and writes it.

## Sheet architecture

Three levels, and the distinction matters:

- **Platform registry** (one, for the whole install, via `.env` — `PLATFORM_SHEET_ID`): the only spreadsheet Pro ERP itself owns. It holds no business data — just two tabs:
  - `Organizations` — `Org_ID | Org_Name | Slug | System_Sheet_ID | Owner_Email | Plan | Status | Created_At`
  - `Users_Index` — `Email | Org_ID | User_ID | Status`, so login can find which organization an email belongs to without scanning every tenant's sheet.

  Both tabs and their header rows are created automatically on the first signup. You only need a blank spreadsheet shared with the service account.

- **Per-organization System spreadsheet** (one per customer, connected at signup): holds that organization's `Users` and `Settings` tabs. Its ID is recorded in the registry — never in `.env`.

- **Per-organization module spreadsheets** (connected from the app): `Tasks`, `Recurring Tasks`, `Holiday List`, `Inward & IQC FMS`, `Failure Log`, `IMS - Inward Sub-Sheet` — each its own Google Sheet, connected by pasting a URL under **Onboarding** or **Admin → Settings**. Header rows are created automatically on first write; you never type out columns.

## Platform setup (once, by whoever runs the install)

1. Google Cloud Console → APIs & Services → enable **Google Sheets API** and **Google Drive API**.
2. IAM & Admin → Service Accounts → create one → Keys → Add Key → JSON (download it). This single service account serves every organization.
3. Create a blank spreadsheet for the registry, share it with the service account's `client_email` as **Editor**, and copy its ID from the URL (`/d/<ID>/edit`).
4. Copy `.env.example` to `.env.local` and fill in `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `PLATFORM_SHEET_ID`, and `JWT_SECRET`.
5. `npm install && npm run dev` → open `http://localhost:3000/signup`.

## How an organization onboards itself

No admin work on your side — this is the self-serve path:

1. The organization visits `/signup` and creates a blank Google Sheet.
2. They share it with the service account address shown right on the signup form, as **Editor**.
3. They fill in organization name, their admin account (name, email, password), and paste the sheet URL. Pro ERP verifies access, refuses a sheet already in use, creates the `Users` + `Settings` tabs with headers, registers the organization, and logs them straight in as Admin.
4. They land on `/onboarding` to paste their module sheet URLs, their Drive folder link, and their ChatXFlow token. Whatever they connect starts working immediately; the rest can be added later from **Admin → Settings**.

### Tenant isolation

Every sheet read/write resolves through `getTenant()` (`src/lib/tenant.ts`), which throws rather than falling back to a default spreadsheet. Cache entries are keyed by organization (`tenantCached`) because a warm serverless instance serves many tenants and the `Settings` tab holds each one's ChatXFlow API token. Cron jobs carrying `CRON_SECRET` walk every active organization in turn; the same routes triggered from the UI run only for the signed-in admin's organization.

### Known scaling limit

All tenants share one Google Cloud project's Sheets API quota, so the per-minute rate limit is split across every organization on the install. Reads are batched, retried with backoff, and cached per org, and cron runs sequentially rather than in parallel — but the ceiling is real. Measure it against your own quota before onboarding a large number of organizations.

## Module 1: Authentication — how it works

> Setup is now handled by the signup flow above; this section documents the mechanics. The manual steps below only apply if you are seeding an organization's `Users` tab by hand.

1. **Create the System spreadsheet** (any Google account). Add a tab named exactly `Users` with this header row (row 1):

   ```
   User_ID | Full_Name | Email | Password_Hash | Role | Department | Phone_Number | Status | Created_At | Created_By
   ```

   Add a second tab named exactly `Settings` with this header row:

   ```
   Key | Value
   ```

2. **Create a Google Cloud Service Account**:
   - Google Cloud Console → APIs & Services → enable **Google Sheets API** and **Google Drive API**.
   - IAM & Admin → Service Accounts → create one → Keys → Add Key → JSON (download it).
   - Open the System spreadsheet → Share → paste the service account's `client_email` → give **Editor** access.

3. **Configure environment variables**: copy `.env.example` to `.env.local` and fill in:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY` — from the downloaded JSON key.
   - `GOOGLE_SHEET_ID` — the System spreadsheet's ID (`/d/<ID>/edit`).
   - `JWT_SECRET` — any long random string (`openssl rand -base64 32`).

4. **Create your first Admin user row** in the `Users` tab manually. Generate the password hash first:

   ```bash
   node scripts/hash-password.mjs "YourChosenPassword"
   ```

   Paste the printed hash into `Password_Hash`. Example row:

   ```
   UID001 | Admin | admin@example.com | <hash> | Admin | Management | +91xxxxxxxxxx | Active | 2026-08-18 | System
   ```

5. **Run the app**:

   ```bash
   npm install
   npm run dev
   ```

   Visit `http://localhost:3000` — it redirects to `/login`. Log in with the row you created; you'll land on `/dashboard`.

## Connecting the module sheets (Admin → Settings)

For each business sheet (Tasks, Inward & IQC FMS, Failure Log, IMS Inward):

1. Create a new blank Google Sheet.
2. Share it with the same service account email (Editor access).
3. Copy its URL and paste it into the matching field on `/admin/settings`, then Save — the app verifies access immediately.
4. The header row appears automatically the first time real data is written to that sheet; nothing to type manually.

## Module 3: Task Delegation — Setup

1. On `/admin/settings`, connect the **Tasks** sheet URL (see "Connecting the module sheets" above).
2. On the same page, under **File Storage**, create a blank Google Drive folder, share it with the service account email (Editor), and paste its folder link. Task attachments and completion proofs upload here.
3. Roles `Admin`, `MD`, and `Delegator` can assign tasks from `/tasks` → **Assign Task**. Every other role only sees their own tasks and marks them Done.
4. A task is "Done on Time" or "Delay Done" based on whether it was completed by its due date.

**Free-tier note**: Vercel's Hobby serverless functions cap request bodies around 4.5MB, so file uploads (`/api/drive/upload`) are limited to 4MB — fine for images/PDFs/Excel, but large videos won't fit. If that becomes a blocker later, the fix is a client-side direct-to-Drive resumable upload instead of relaying through our API route.

## Module 4: Dashboard & MIS Score

- Tasks carry `On_Time_Count` and `Delay_Count` columns (added to the Tasks sheet headers), incremented every time a task is completed. *(Recurring tasks originally rolled a single row forward on completion instead of getting a new row per occurrence — that mechanism was replaced by the proper occurrence-generating engine described in "Recurring Task Engine" below. The counters themselves are unaffected and still used the same way.)*
  - **If you connected a Tasks sheet before this module**, its header row won't have these two columns yet — add `On_Time_Count` and `Delay_Count` as the next two column headers yourself; existing rows are unaffected (new writes just land in the new columns, positionally).
- **"Not Done" is never stored** — it's derived at read time: a task counts as Not Done only while it's still `Pending` and its due date has passed. This is what "dynamic MIS score" means in practice: nothing needs a cron job to flip a status.
- **Scoring formula** (`src/lib/mis.ts`): `score = round((onTime × 1 + delay × 0.5) / (onTime + delay + notDone) × 100)`, shown as `—` when a user has nothing evaluated yet. Weights are constants at the top of that file if the business wants different credit for a late completion.
- `/dashboard` now shows each user's own pending/completed counts, MIS score, and upcoming tasks — computed server-side directly from the Tasks sheet, no extra client round-trip.
- `/performance` (Admin/MD/Delegator only) shows the same breakdown for every active user, sorted by score — a simple team leaderboard.

**Assign-task form fields** (updated): User Name (Department shows automatically once picked, read from that user's `Users` row — not duplicated onto the task), Priority (Low/Medium/High/Urgent), Task title + description, Attachment (optional), Completion — now a **date & time** picker (`Due_Date` stores `YYYY-MM-DDTHH:mm`), so on-time/delay is judged to the minute, not just the day. On the assignee's side (`/tasks` and `/dashboard`), the attachment shows as a plain **View** link that opens the file in a new tab, alongside Priority and Completion.

**If you connected a Tasks sheet before this update**, add `Priority` as the next column header (after `Delay_Count`) — same non-breaking, position-based append as the counters above.

## Module 5: WhatsApp Integration (ChatXFlow)

ChatXFlow's own WhatsApp QR-connect step happens entirely on **chatxflow.online** — Pro ERP never renders a QR code itself. Once an admin has connected their number there and grabbed a Developer API Token from ChatXFlow's dashboard, they just paste it into Pro ERP:

1. Go to `/admin/settings` → **WhatsApp (ChatXFlow)**.
2. Paste the **API Token** (from ChatXFlow's Developer API panel), the **WhatsApp Mobile Number** (for reference), and confirm the **Base URL** (defaults to `https://chatxflow.online`).
3. Save, then **Send Test Message** — this sends a real WhatsApp message to the saved number via `src/lib/chatxflow.ts`, which calls ChatXFlow's `POST /api/v1/send` with the token as a Bearer header. If that arrives, the integration is live.

**Two automations**, both built on that same `sendWhatsAppMessage()` helper:

- **Completion confirmation** (`src/app/api/tasks/[taskId]/complete/route.ts`): the instant a task is marked Done, the assigner gets a WhatsApp message naming who completed it and whether it was on time or late. Fire-and-forget — a WhatsApp failure never blocks the completion itself.
- **Pending task reminders** (`src/lib/reminders.ts`, `POST /api/whatsapp/send-reminders`): messages every active user their current pending-task checklist (flagging overdue ones). Trigger it two ways:
  - **Manually** — the "Send Reminders Now" button on the same Settings page (Admin-only).
  - **Automatically** — `vercel.json` already schedules a daily Vercel Cron hit at 09:00 UTC. Set a `CRON_SECRET` env var (any random string) in both `.env.local`/Vercel and the route uses it to recognize a genuine Cron call vs. a stranger's request. Vercel's Hobby (free) tier supports cron jobs but only once-daily schedules, which is exactly what this needs.

The API token is stored in the `Settings` tab like everything else — never sent to the browser; `/admin/settings` only ever receives a masked preview (`AQ.Ab8••••••••iCwQ`-style) of the currently saved token.

## Module 6: Inward FMS & IQC Workflow

Uses three of the module sheets connected back in "Connecting the module sheets" above: **Inward & IQC FMS**, **Failure Log**, **IMS - Inward Sub-Sheet**.

1. **`/inward`** — any logged-in user submits a new entry (Party Name, Invoice No., Inward Type, optional Attachment, optional Remark) via **New Inward Entry**. It's appended to the Inward & IQC FMS sheet with a generated `Entry_ID`, a `Timestamp`, and `IQC_Status = Pending`.
2. **IQC review** — anyone with the `IQC` or `Admin` role sees a **Quality Check** button on pending entries, both on `/inward` and as a dedicated "Pending Quality Checks" card on `/dashboard` (matching where the spec says this should surface). The modal has the "Verify material against invoice" checkbox, IQC Pass Qty, IQC Fail Qty, and a Fail Reason field that's required whenever Fail Qty > 0.
3. **On Save** (`src/lib/inward.ts` → `submitQualityCheck`): the Inward entry itself is updated to `Verified`. If Fail Qty > 0, a row is appended to **Failure Log** (full entry + fail qty/reason, linked by `Linked_Entry_ID`). If Pass Qty > 0, a row is appended to **IMS - Inward Sub-Sheet** (linked the same way). An entry with both a pass and a fail quantity correctly lands in both sheets.

`src/lib/moduleSheets.ts` now exports `recordToRow()`, a small generic used by both `tasks.ts` and `inward.ts` to map a record onto its sheet's declared header order — one place to get that mapping right instead of three.

## Recurring Task Engine

Replaces the earlier "single row rolls forward on completion" mechanism (Module 4) with proper occurrence generation — each scheduled occurrence is its own Tasks row with a real Plan date and, once done, a real Actual timestamp, which is what makes per-occurrence MIS history possible.

**Two new module sheets** to connect from `/admin/settings` (same URL-paste flow as the others):

- **Recurring Tasks (definitions)** — one row per repeating rule: `Recurring_ID`, `Task`, `Doer_ID`, `Assigned_By`, `Frequency`, `Assign_Date`, `Status`, `Created_At`. Created from `/tasks` → **Assign Recurring Task** (Doer Name, Department shown automatically, Frequency, Task, Assign Date).
- **Holiday List** — just one column, header `Date` in A1, one holiday per row from A2 down. **Enter dates as plain text in `YYYY-MM-DD` format** (e.g. `2026-01-26`) — if you just type a date into a Google Sheets cell it auto-formats to your locale's date display and won't string-match; format the column as Plain Text first, or prefix each entry with `'` to force text.

The Tasks sheet also gained a `Recurring_ID` column (append it as the next header if you connected Tasks before this) — it links a generated occurrence back to the rule that created it, and is how the generator avoids creating the same day's occurrence twice.

**Frequency codes**: `D` Daily, `W` Weekly, `15D` every 15 days, `M` Monthly, `Q` Quarterly, `Y` Yearly.

**Daily generation** (`src/lib/recurringGenerator.ts`, run by the second Vercel Cron entry in `vercel.json` at 01:30 UTC / 07:00 IST): for every `Active` rule, it checks whether today (computed in IST, `src/lib/dateUtil.ts`) matches the rule's cycle —

- `D`: every day.
- `W` / `15D`: every 7 / 15 days counted from `Assign_Date`.
- `M` / `Q` / `Y`: same day-of-month as `Assign_Date`, every 1 / 3 / 12 months — if that day doesn't exist in the current month (e.g. the 31st against a 30-day month, or Feb 29 in a non-leap year), the month's last day counts instead, so the cycle never gets silently dropped.

If today is in the **Holiday List**, that occurrence is skipped entirely for every frequency (not just Daily) — the next one still lands on its normal, unshifted cycle date. Skipped occurrences aren't backfilled.

Once generated, an occurrence behaves exactly like a one-time task: the Doer marks it Done from `/tasks`, `Completed_At` is stamped, and `Status` becomes `Done on Time` or `Delay Done` for good — it does not reset back to Pending. There's no pause/deactivate UI yet; to stop a rule, edit its `Status` cell in the Recurring Tasks sheet directly (the generator only processes rows where `Status = Active`).

## Architecture notes

- All Google API calls happen **only** in Next.js Route Handlers (`src/app/api/**`) and server components — the service account key never reaches the browser.
- Sessions are signed JWTs (`jose`, edge-compatible) in an `httpOnly` cookie, checked in `src/proxy.ts` (Next.js 16's "proxy", formerly "middleware") to protect every route except `/login`.
- `src/lib/cache.ts` provides a short-TTL in-memory cache to reduce Sheets API calls for read-heavy pages; login and settings writes always read fresh.
- `src/lib/moduleSheets.ts` resolves each module's configured URL to a spreadsheet + tab, and lazily creates that tab's header row on first write.
- `src/lib/googleAuth.ts` holds the one shared service-account client that both `googleSheets.ts` and `googleDrive.ts` authenticate with.

## Deploy on Vercel

Push to a Git repo, import into Vercel, and add the same environment variables from `.env.local` in the Vercel project settings (Production + Preview).
