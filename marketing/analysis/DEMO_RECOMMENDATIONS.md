# DEMO_RECOMMENDATIONS.md — Pro ERP

Recommended live-UI capture order for the 60-90s video, matched to the Sales-chain narrative
(see USER_WORKFLOW.md). Demo org: "Orion Auto Components" (seeded via
`marketing/scripts-seed/seed-demo-org.ts`), entirely fictional data.

| # | Screen | URL (local) | Why | Capture type |
|---|---|---|---|---|
| 1 | Login | `/login` | Clean, modern entry point | Screenshot |
| 2 | Dashboard | `/dashboard` | Immediate "real SaaS product" signal — charts, MIS score | Screenshot + short scroll recording |
| 3 | Leads pipeline | `/leads` | Visual Kanban-style stages, business story begins | Screenshot |
| 4 | Quotation builder | `/leads/quotations/[id]` | PDF generation, line-item math — shows depth | Screenshot |
| 5 | Orders — Stock_Check | `/orders` | Live reservation number, credit gate | Screenshot |
| 6 | PDI inspection | `/pdi` | Pass/Fail gate, quality control narrative | Screenshot |
| 7 | TMS / Dispatch | `/tms`, `/dispatch` | Gate Pass, the real stock-ledger write | Screenshot |
| 8 | Accounts — GL | `/accounts` | Real double-entry bookkeeping, Trial Balance | Screenshot |
| 9 | FMS Template Builder | `/fms/templates` | THE differentiator — no-code workflow engine | Screenshot + short interaction recording |
| 10 | Inventory | `/inventory` | Free/On-Hand/ROP live numbers | Screenshot |
| 11 | Command palette | any page, Ctrl+K | Fast, satisfying power-user motion, great for a close-up | Short recording |
| 12 | Mobile sidebar | any page, 390x844 | Proves responsive/mobile-ready | Screenshot |

## Capture settings

- Desktop viewport: 1920x1080 (matches the 16:9 render target 1:1, no upscaling needed).
- Mobile viewport: 390x844 (iPhone 12/13 class) for the mobile proof shot and the 9:16/1:1 recomposes.
- Dark mode: capture once in light, once in dark for variety in the social creative pack
  (the product supports both — CLAUDE.md's "visual refresh" notes confirm theme support).
- Always use the seeded demo org — never a real customer's org, never real data.

## What NOT to show

- Platform console (`/platform`) — has org-management actions with no demo-safe reason to
  expose in a public marketing video (shows every org's own name).
- Any screen containing a real phone number/email outside the fictional `*-demo.local` set.
- Payroll salary figures beyond the fictional seeded amounts.
