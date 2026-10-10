**Headline:** Free Stock, Explained: What "Available to Sell" Actually Means

**Supporting copy:** A 6-slide LinkedIn document carousel explaining Pro ERP's live stock reservation math — why "Free stock" is harder to compute correctly than it looks, and how Pro ERP gets it right.

**CTA:** See live stock in action → pro-erp-chi.vercel.app

**Visual concept:** 6 slides, 1200x1200 each, dark navy, a simple formula graphic on slide 2 (text-based, no chart library), real inventory screenshot on slides 3 and 5.

**Aspect ratio:** 1200x1200 (per slide)

**Recommended screenshot:** 10-inventory.png (slides 3, 5), 04-orders.png (slide 4)

**Final text (carousel caption):** "'Free stock' sounds simple until you try to calculate it correctly. Here's how Pro ERP gets this number right, live, every time — swipe through." CTA: See live stock in action → pro-erp-chi.vercel.app

---

### Slide-by-slide

**Slide 1 — Title**
Headline: "What Does 'Free Stock' Actually Mean?"
Bullets:
- It's the number that tells you what you can safely promise a customer
- Most spreadsheets get it wrong constantly

**Slide 2 — The formula**
Headline: "Free = On Hand − Committed − Reserved"
Bullets:
- On Hand: physically in the warehouse right now
- Committed: already earmarked for production (raw material)
- Reserved: already allocated to a confirmed order

**Slide 3 — Why spreadsheets fail here** (screenshot: 10-inventory.png)
Headline: "A spreadsheet can't track all three sources live"
Bullets:
- Committed and Reserved change every time someone confirms an order or starts production
- By the time the spreadsheet is updated, the number is already stale

**Slide 4 — How it's enforced in Pro ERP** (screenshot: 04-orders.png)
Headline: "Recalculated live, the moment anything changes"
Bullets:
- Order confirmation immediately reserves the Free stock it uses
- Shortage triggers an automatic Task + WhatsApp alert

**Slide 5 — Automatic FIFO top-up** (screenshot: 10-inventory.png)
Headline: "New stock arrives? It goes to the oldest waiting order first"
Bullets:
- Automatic FIFO re-allocation against open shortages
- No one has to remember to do this manually

**Slide 6 — Close**
Headline: "A number you can actually trust before you promise it"
Bullets:
- Enforced in code, not tribal knowledge
- Fewer "we promised stock we didn't actually have" mistakes
CTA: See live stock in action → pro-erp-chi.vercel.app
