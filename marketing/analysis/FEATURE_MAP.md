# FEATURE_MAP.md — Pro ERP

Route → Module → Grant required → What a visitor sees, verified against `src/app/**` and
`src/lib/moduleAccess.ts`. Admin role implicitly holds every grant (`effectiveModuleAccess()`).

| Route | Module | Grant key | Core screen |
|---|---|---|---|
| `/dashboard` | Dashboard & MIS | none (own data) | Per-user MIS score, analytics charts, quick-nav |
| `/performance` | Team Performance | `PERFORMANCE_VIEW` | Team-wide MIS scoring table |
| `/tasks` | Task Delegation | `TASK_DELEGATE` / `RECURRING_ASSIGN` | Task board, recurring rules |
| `/leave` | Leave (buddy system) | `LEAVE_HR` for HR actions; filing needs none | Apply/approve leave, buddy reassignment |
| `/payroll` | Payroll v1 | Role-gated (Admin console) | Payslips, admin run console |
| `/chat` | AI Chatbot | `AI_CHATBOT` | Gemini-backed assistant, tool-gated |
| `/inward` | Inward FMS & IQC | `INWARD_ENTRY` / `IQC_CHECK` / `IMS_VIEW` | Inward entry, QC modal, failure log |
| `/inventory` | Inventory | `INVENTORY_VIEW` / `INVENTORY_TXN` | Live stock, Free/On-Hand/ADC/ROP |
| `/inventory/fg` | Finished Goods | `INVENTORY_VIEW` | FG-only stock view |
| `/inventory/setup` | Item Master | `INVENTORY_SETUP` | New item, bulk import |
| `/inventory/indents` | Indents | `INDENT_APPROVE` | Approve/receive purchase indents |
| `/inventory/reorder` | Reorder | `INVENTORY_VIEW` | Vendor-suggested reorder board |
| `/bom` | BOM | `BOM_MANAGE` | Bill of Materials builder, versioned |
| `/ppc` | Production Planning | `PPC_PLAN` | Create plans, reserve material, start/complete production |
| `/parties` | Vendor & Customer Master | `PARTY_MASTER` | Manual add + bulk import, vendor-item linking |
| `/purchase` | Purchase | `PURCHASE_FMS` (+`INDENT_APPROVE` for step 1) | Indent→PO Issue→Follow Up→Material Received |
| `/leads` | Lead & Quotation | `LEAD_FMS` | Pipeline board, quotation builder, walk-in quotation |
| `/orders` | Order | `ORDER_FMS` | Lead-sourced + Direct order intake, credit gate, stock reserve |
| `/pdi` | PDI | `PDI_FMS` | Pass/Fail inspection before dispatch |
| `/tms` | Transport | `TMS_FMS` | Plan Shipment, Loading Dock confirm |
| `/dispatch` | Dispatch | `DISPATCH_FMS` | Gate Pass, Confirm/Mark Dispatched, Proof of Delivery |
| `/accounts` | Accounts | `ACCOUNTS_FMS` | Invoices, Bills, GL, Credit/Debit Notes, Aging, GST Report |
| `/maintenance` | Maintenance | `MAINTENANCE_FMS` | Breakdown requests, Production Line pause/resume |
| `/fms` / `/fms/[templateId]` | Generic FMS engine | `FMS_ADMIN` to build; per-flow Nav otherwise | Templates board, Flow Board |
| `/platform` | Platform console | Platform Admin (env var list, not a grant) | Orgs, usage metrics, error log, chatbot audit |
| `/admin/users`, `/admin/settings` | Admin | Role = Admin | User mgmt, org-wide config |
| Global ⌘K | Command palette | per-module (skips what the user lacks) | Cross-module instant search |

## Best screens for a demo (cinematic value + business value both high)

1. **Dashboard** — immediate "this is a real product" signal: charts, MIS score, quick-nav.
2. **FMS Template Builder** — the single most differentiating feature; show a flow being built.
3. **Lead → Quotation pipeline board** — drag-feel Kanban-style stages, clear business narrative.
4. **Order FMS / Stock reservation** — a live number (Free stock) changing is a strong visual.
5. **Accounts — GL / Trial Balance** — signals "this is not a toy," real double-entry under the hood.
6. **Command palette (⌘K)** — a fast, satisfying power-user motion for a product-video close-up.
7. **Mobile sidebar / responsive layout** — proves it isn't desktop-only.
