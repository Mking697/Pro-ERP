# PRODUCT_USP.md — Pro ERP

Only claims directly supported by code already read in this repository. No invented
statistics, no comparison to named competitors (not verifiable), no claims about scale this
app hasn't demonstrated.

## 1. One connected system, not five disconnected tools

Lead, Quotation, Order, PDI, Transport, Dispatch, Invoice, and the General Ledger all hand off
to each other via real application events — a Lead becoming an Order becoming a Dispatch
becoming a posted journal entry, inside one product, with one login.

## 2. A no-code workflow engine (FMS) that can move real inventory

Most "workflow builder" features in small-business software are glorified checklists. Pro
ERP's FMS lets an Admin build a multi-step process with role-gated steps, a working-hours-aware
deadline calendar (down to the minute), branching outcomes, and a step that can write directly
to the stock ledger — enforced server-side, not just in the UI.

## 3. Stock numbers that are actually trustworthy

"Free stock" is computed live from four independent sources at once — on-hand, raw-material
commitment, in-transit, and order reservation — and automatically re-allocates to the oldest
waiting order (FIFO) the moment new stock arrives. Most spreadsheet-based operations get this
wrong constantly; this is enforced in code, not tribal knowledge.

## 4. Real accounting underneath, not a bolted-on invoice generator

Double-entry General Ledger, GST tracked as its own liability (not folded into revenue),
Input Tax Credit recognized on the Payables side, auto-posted from four real business events.
Receivables Aging and a GSTR-shaped export give an accountant something they can actually use.

## 5. WhatsApp-first operations

People who run a factory floor don't live in a browser tab. Step completions, stock shortages,
leave approvals, and debit-note follow-ups all reach the right person on WhatsApp automatically.

## 6. An AI assistant that cannot make things up

The chatbot is tool-gated to exactly the modules the asking user already has access to, has a
deterministic "I don't have that information" fallback instead of ever guessing, and every
answer is audited at the platform level.

## Business value framing (for the voiceover, each line must map to something above)

- Less time spent chasing status over phone/WhatsApp — the workflow carries it automatically.
- Fewer "we promised stock we didn't actually have" mistakes.
- An accountant can trust the numbers without a backroom spreadsheet reconciliation.
- Any process unique to one's own factory can be modeled without hiring a developer.
