# Inventory · BOM · PPC — build specification

Agreed with the user on 2026-08-19.

**Phase 1 is built and verified against live sheets (2026-08-20).** Phases 2-5 are still
the plan. Progress is tracked in the build-order table at the bottom.

Replaces a Google-Sheets + Apps Script system the user already runs ("Ultimate IMS
V3.0"). That system's core idea is right and is kept: **stock is never stored, it is
always derived from an append-only transaction ledger.** What it lacks is that its
reorder maths ignores the fields it collects — it computes `Max Level − Closing Stock`
and never uses ADC, Lead Time, Safety Factor, MOQ or Material In Transit. Closing that
gap is the main value of this build.

Scope now: **Raw Material + Consumable**. Semi-FG → PDI → Packing → FG → Dispatch comes
later, but the schema below leaves room for it deliberately (see "Room left for Semi-FG").

---

## Decisions taken (do not re-litigate)

| # | Decision |
|---|---|
| 1 | Stock is derived from the ledger, never stored as a mutable number. |
| 2 | An `Out` that exceeds free stock is **blocked**, not warned. |
| 3 | ADC is **both** — computed from the ledger, with a manual override that wins when set. |
| 4 | IQC pass quantity **automatically becomes a stock In**. |
| 5 | Quantities support **decimals** (kg, m, litre). |
| 6 | `Location` is **a label only** — one stock pool, not per-location stock. Revisit only when two godowns genuinely run separately. |
| 7 | Indent quantity = cover the shortage **and** top up to Max Level, never below MOQ — and the **user can edit it** before submitting. |
| 8 | Shortage is computed against a **shared material pool**, allocated **earliest production date first**, but **each product still shows its own status**. |
| 9 | Submitting a plan **reserves** material. PPC and reorder both read *free* stock, not on-hand. |
| 10 | Material is consumed (Out) when a **Production Department user presses "Start Production"** — not automatically on the date. Production users will exist per stage. |
| 11 | Start Production **asks the actual quantity**; any leftover reserve is **released immediately**. |
| 12 | A plan **snapshots its BOM** at creation. A later BOM edit never changes an existing plan. |
| 13 | Indent approval lives on the **PPC dashboard**; PPC approves for raw material, and **Store can also approve**. |
| 14 | The user fills `Max Level` and `Lead Time` themselves — a **bulk setup screen** is needed for this. |

### A caution carried over from their current data

In the example sheet, `Max Level` was `5` for every item while `MOQ` ranged 20–310.
That made `Available %` read 2460%, painted the whole sheet purple, and made
`Reorder Qty = Max Level − Closing Stock` permanently negative — so **nothing ever suggested a
reorder**. The user confirmed that sheet was only an example, but the failure mode is
common: *the formulas are only as good as `Max Level`, `Lead Time` and `Safety Factor`.*
The Bulk Setup screen exists to make filling them cheap, and the UI should visibly flag
items where these are unset rather than silently computing nonsense.

---

## Sheets

Each is its own Google Spreadsheet, connected by pasting a URL in Settings — same pattern
as every existing module (see `src/lib/moduleSheets.ts`).

### `Items` — master
```
SKU | Item_Name | Category | Size_Unit | UOM | Rate
ADC_Manual | Lead_Time_Days | Safety_Factor | MOQ | Max_Level
Location | Status | Created_At | Created_By
```
- `Category`: `Raw Material` · `Consumable` (later `Semi-FG` · `FG`)
- `ADC_Manual`: blank means "use the computed value"
- `Status`: `Active` · `Inactive`

### `Stock_Ledger` — append-only, never edited
```
Txn_ID | Timestamp | SKU | Direction | Quantity | UOM
Source | Reference_ID | Location | Issued_To | Remark | User_ID
```
- `Direction`: `In` · `Out`
- `Source`: `Opening` · `Manual` · `Form` · `IQC` · `Production` · `Production_Output` · `Indent_Receipt` · `Adjustment`
- `Reference_ID`: the IQC entry, plan, or indent this movement came from

`Source` is what makes the ledger readable six months later — without it no one can tell
why a number moved.

### `BOM`
```
BOM_ID | Product_Name | Product_SKU | Version | Line_No
Component_SKU | Component_Name | Component_Type | Qty_Per_Unit | UOM
Status | Created_At | Created_By
```
- Flat: one row per BOM line, grouped by `BOM_ID`
- `Component_Type`: `Item` today, `Product` later for sub-assemblies
- `Status`: `Active` · `Archived`; editing a BOM archives the old version rather than overwriting

### `Production_Plans` — header
```
Plan_ID | Timestamp | Product_Name | Product_SKU | Planned_Qty | Production_Date
Status | Created_By | Notes
```
`Status`: `Draft` → `Shortage` → `Ready` → `Submitted` → `In_Production` → `Completed` · `Cancelled`

### `Plan_Materials` — the plan's frozen BOM
```
Plan_ID | SKU | Item_Name | Required_Qty | UOM
Allocated_Qty | Shortage_Qty | Consumed_Qty | Status
```
This *is* the BOM snapshot (decision 12).

### `Indents`
```
Indent_ID | Timestamp | SKU | Item_Name | Suggested_Qty | Final_Qty | UOM
Reason | Linked_Plan_ID | Status | Requested_By | Approved_By | Approved_At
Expected_Date | Received_Qty | Received_At
```
- `Reason`: `Reorder` · `Production_Shortage`
- `Status`: `Pending` → `Approved` → `Ordered` → `Partially_Received` → `Received` · `Cancelled`

---

## Formulas

```
on_hand    = Σ(In.qty) − Σ(Out.qty)                      from Stock_Ledger
in_transit = Σ(Final_Qty − Received_Qty)                 Indents in Approved/Ordered/Partially_Received
committed  = Σ(Allocated_Qty − Consumed_Qty)             Plans in Submitted/In_Production

free       = on_hand − committed          ← PPC and reorder read THIS, never on_hand
projected  = on_hand + in_transit − committed

ADC_auto   = Σ(Out.qty over window) ÷ days_in_window     window default 30d
ADC        = ADC_Manual if set, else ADC_auto
ROP        = ADC × Lead_Time_Days × Safety_Factor
```

**Item status**

| Status | Condition |
|---|---|
| Out of Stock | `free ≤ 0` |
| Critical | `free ≤ ROP` |
| Low | `free ≤ ROP × 1.5` |
| Overstock | `free > Max_Level` |
| Healthy | otherwise |

**Indent quantity suggestion**
```
suggested = max(shortage, Max_Level − projected, MOQ)
          → rounded up to the next multiple of MOQ
```
Editable on screen before submitting (decision 7).

---

## The PPC allocation algorithm

The one piece where this kind of system usually goes quietly wrong: checking each product
against stock *independently* lets two products both report "Done" while together they
exceed what exists.

```
INPUT: lines = [(product, planned_qty, production_date), …]

1. Sort lines by production_date ascending; ties keep selection order.
   (Whatever is built first gets the material first; a product three weeks out can wait
   for the indent to arrive.)

2. pool[sku] = free_stock(sku)          // already excludes other plans' reservations

3. For each line, in that order:
     required  = BOM(product)[sku].Qty_Per_Unit × planned_qty
     take      = min(required, pool[sku])
     allocated = take
     shortage  = required − take
     pool[sku] -= take                  // the next line only sees what is left

4. line.status = "Shortage" if any shortage > 0 else "Ready"
5. plan.status = "Ready" only if every line is Ready
```

Worked example — 100 screws in stock:

| Product | Production date | Needs | Gets | Short | Status |
|---|---|---|---|---|---|
| A | 22 Aug | 80 | 80 | 0 | Ready |
| B | 25 Aug | 60 | 20 | **40** | Shortage |

Each product keeps its own badge (what the user asked for) and the totals stay honest.
The indent that follows is raised for B's 40.

---

## Lifecycle

```
Plan created      → BOM snapshot written to Plan_Materials, allocation run
Plan submitted    → Allocated_Qty becomes committed; free stock drops for everyone else
Start Production  → a Production Dept user presses it and enters the ACTUAL quantity
                    → Out rows written to the ledger (Source = Production)
                    → leftover reserve released immediately (decision 11)
Completed         → plan closed
```

Shortage → indent → approved → ordered → received:
```
Received  → In rows written (Source = Indent_Receipt), in_transit falls
```

---

## Screens

**IMS**
1. **Items** — live status badge, filters (category / status / location), search
2. **Bulk Setup** — grid to fill `Max_Level`, `Lead_Time_Days`, `Safety_Factor`, `MOQ`, `ADC_Manual` across many items at once
3. **Stock In/Out** — one form, direction toggle; `Out` blocked above free stock
4. **Item detail** — on-hand / free / committed / in-transit shown separately, ROP, ADC (auto vs manual), movement history, stock-over-time chart
5. **Reorder** — items at or below ROP, editable suggested quantity, select → raise indents

**BOM**
6. **BOM list** — products, version, status
7. **BOM form** — product name, number of lines → that many rows; per row a fuzzy item
   search that fills `SKU` and `UOM` automatically, user enters only `Qty_Per_Unit`

**PPC**
8. **Plan builder** — multi-select products, each with quantity + production date, live
   shortage check, per-product status
9. **PPC dashboard** — indents awaiting approval, plans by status, upcoming production dates
10. **Plans history** — each plan with its frozen material snapshot

---

## New access grants

Added to `src/lib/moduleAccess.ts`:

| Key | For |
|---|---|
| `INVENTORY_VIEW` | see items and stock |
| `INVENTORY_TXN` | record In/Out |
| `INVENTORY_SETUP` | edit the item master (Max Level, Lead Time, …) |
| `BOM_MANAGE` | create and edit BOMs |
| `PPC_PLAN` | create production plans |
| `INDENT_APPROVE` | approve indents — given to PPC **and** Store (decision 13) |

Production-stage users get `INVENTORY_TXN` so they can press Start Production.

---

## Room left for Semi-FG (build later, design now)

The path is `Semi-FG → PDI → Packing → FG → Dispatch`. Three things cost nothing today
and would be expensive to retrofit:

1. **`Component_Type` on BOM** — so a BOM line can one day point at another product.
2. **`Production_Output` in the ledger's `Source`** — production does not only consume
   material, it *creates* it. A Semi-FG must be able to enter stock and then become an
   input to an FG's BOM.
3. **Products live in `Items` with their own SKU** — a Semi-FG is simultaneously an output
   and an input, so it has to be an item like any other.

---

## Build order

| Phase | Contents |
|---|---|
| **1** ✅ | `Items` master + `Stock_Ledger` + In/Out (blocking negative) + IQC pass → auto In. Verified end to end: ADC 250.5/30 = 8.35, ROP 8.35 × 7 × 1.5 = 87.675, an Out of 99999 against 1749.5 free refused with 409, and an IQC pass of 800 lifting free stock 1749.5 → 2549.5 with `Source = IQC` traceable to its inward entry. Bulk Setup fills the planning fields across many items in one batched write, touching only edited cells. Verified: setting Lead Time 10, Safety 1.2 and a manual ADC of 3 produced ROP 36, with the item's name untouched. |
| **2** ✅ | ADC, ROP, live status, Reorder screen, Indents. Verified end to end: an Out of 2500 raised ADC and with it the reorder point (87.7 → 962.7), the item appeared with a suggested 5000 (`max(0, 5000−49.5, 500)` rounded up to the MOQ multiple), a Pending indent counted 0 in transit while an Approved one counted 5000 and removed the item from the list, a partial receipt of 2000 moved free 49.5 → 2049.5 and in-transit 5000 → 3000 while **projected stayed 5049.5**, over-receiving was refused with 409, and both receipts landed with `Source = Indent_Receipt` referencing the indent. |
| **3** | BOM — sheet + form |
| **4** | PPC — plan builder, shared-pool allocation, reserve, Start Production, indent from shortage, PPC dashboard |
| **5** | Production execution detail, Semi-FG, PDI, Packing, Dispatch |

Phase 1 first because nothing else can be verified without a working ledger.

---

## Still open

- Exact `Category` list beyond Raw Material / Consumable.
- Whether indent approval should also send a WhatsApp notification (the sender already
  exists) or stay dashboard-only. User said dashboard; revisit if they want the nudge.
- How opening balances get loaded (probably a one-off `Source = Opening` import through
  Bulk Setup).
