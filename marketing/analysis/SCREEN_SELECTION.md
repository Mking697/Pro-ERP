# SCREEN_SELECTION.md — Pro ERP

Final shot list selected for capture, with the exact navigation path from a fresh login,
cross-checked against real route files in `src/app/**`. Captured via
`marketing/scripts-capture/capture-screens.mjs` (Playwright, headless Chromium, local only).

| Shot ID | Route | Pre-condition | Notes |
|---|---|---|---|
| 01-login | `/login` | logged out | |
| 02-dashboard | `/dashboard` | logged in as demo Admin | |
| 03-leads | `/leads` | logged in | pipeline board |
| 04-orders | `/orders` | logged in | |
| 05-pdi | `/pdi` | logged in | |
| 06-tms | `/tms` | logged in | |
| 07-dispatch | `/dispatch` | logged in | |
| 08-accounts | `/accounts` | logged in | GL / Trial Balance tab |
| 09-fms-templates | `/fms/templates` | logged in, Admin | |
| 10-inventory | `/inventory` | logged in | |
| 11-tasks | `/tasks` | logged in | |
| 12-parties | `/parties` | logged in | Vendor & Customer Master |
| 13-ppc | `/ppc` | logged in | Production Planning |
| 14-bom | `/bom` | logged in | |
| 15-dashboard-mobile | `/dashboard` | logged in, 390x844 viewport | mobile proof |
| 16-dashboard-dark | `/dashboard` | logged in, dark theme toggled | variety for creatives |

All screenshots land in `marketing/screenshots/<shot-id>.png`. Screen recordings (if captured)
land in `marketing/recordings/`.
