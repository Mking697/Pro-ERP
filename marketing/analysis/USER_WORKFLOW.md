# USER_WORKFLOW.md — Pro ERP

The end-to-end chain the product video should narrate, verified against CLAUDE.md's module
descriptions and the actual lib functions (`src/lib/leads`, `src/lib/orders`, `src/lib/pdi`,
`src/lib/tms`, `src/lib/dispatch`, `src/lib/accounts`).

## The Sales chain (the spine of the whole product story)

```
Lead captured (manual or bulk import)
   -> Qualify -> Follow-Up (loop) -> Meeting Scheduled (loop) -> Negotiation
   -> Quotation Sent (PDF, GST, bank details)
   -> Order Confirmed
        |
        v
Order FMS
   - Lead-sourced order maps quotation lines to real Items/Customer
   - OR Direct order (salesperson's own form)
   -> Payment_Review (credit-limit / credit-days / advance-payment gate)
   -> Stock_Check (reserves Free stock, shortage triggers Task + WhatsApp)
   -> Dispatch_Pending -> Ready_For_PDI
        |
        v
PDI (Pre-Dispatch Inspection)
   -> Pass (optional report upload) -> ORDER_PDI_PASSED event
   -> Fail loops back to Pending (same row, not a new one)
        |
        v
TMS (Transport)
   - Self (org arranges, pays freight) or Party (customer arranges pickup)
   -> plans shipment(s), confirms Loading Dock
        |
        v
Dispatch
   -> Confirm Dispatch: allocates Gate Pass, writes the ONE real stock-ledger "Out"
      in this whole chain (everything upstream only reserved, never moved stock)
   -> Mark Dispatched (+ optional Proof of Dispatch)
   -> Proof of Delivery (customer has it)
        |
        v
Accounts
   -> Invoice (GST split out as a liability, not folded into revenue)
   -> Payments tracked against Receivables Aging
```

## The Purchase chain (mirror image, buy-side)

```
Indent raised -> Indent Approved (INDENT_APPROVED event)
   -> PO Issue (vendor-first: pick vendor, bundle every indent they supply, PDF or manual PO)
   -> Follow Up (deadline = vendor's lead time - 1 day)
   -> Material Received (partial/full qty, stock updated)
        |
        v
Accounts (Payables)
   -> Bill (GST extracted from vendor's inclusive total -> Input Tax Credit)
   -> Payment tracked, Debit Note path for IQC failures
```

## The Production chain

```
BOM defined (versioned, like a recipe)
   -> Production Plan created (reserves raw material across a shared pool)
   -> Start Production -> optionally drives a named FMS "Production Line"
      (a multi-step flow ending in a Ledger Movement Action)
   -> Complete Plan -> Finished Goods stock-in (exactly one writer, never double-counted)
```

## Why this sequence makes a strong 60-90s video

Each leg hands off to the next via a real, named event
(`LEAD_ORDER_CONFIRMED` -> `ORDER_READY_FOR_PDI` -> `ORDER_PDI_PASSED` -> `ORDER_FULLY_SHIPPED`)
— this is genuinely a connected system, not five separate screens. The video's narrative spine
should literally be: one lead becomes cash in the bank, and the camera should move through the
UI in exactly this order.
