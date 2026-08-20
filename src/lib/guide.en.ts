import type { GuideChapter } from "@/lib/guide";

/**
 * The guidebook in English.
 *
 * Long-form prose is kept as a parallel structure rather than as dictionary entries. A
 * paragraph used as a lookup key is brittle — one edited comma in the Hinglish source and
 * the English silently disappears — and translating prose is far more reliable when the
 * section around it is visible. `npm run i18n:check` compares the two files' chapter and
 * section ids, so a section added to one and forgotten in the other is reported.
 */
export const GUIDE_EN: GuideChapter[] = [
  {
    id: "basics",
    title: "Getting started",
    description: "For every user, whatever their role.",
    sections: [
      {
        id: "what-is",
        title: "What Pro ERP is",
        audience: "everyone",
        summary:
          "This is the system that runs your organization's work — task delegation, recurring jobs, material inward and quality checks, inventory and stock, product BOMs, production planning, and everybody's performance scoring. All of the data lives in your organization's own Google Sheets; Pro ERP simply reads and writes them.",
        how: [
          "One idea runs through the whole system: no figure is ever stored anywhere — it is always worked out afresh from the real entries.",
          "Your MIS score is not written in a box; it is built from the timestamps on your tasks. An item's stock is not written anywhere either; it is the sum of every In and Out.",
          "This buys two things. First, no figure is ever out of date — even if a background job were to fail, you would never see a wrong number. Second, every figure can be explained: \"where did this come from?\" always has an answer.",
        ],
        notes: [
          "The modules you can see are the ones your Admin gave you. You will never see another organization's data.",
          "After being given a new module, sign out and back in once — what you can reach is decided at sign-in.",
        ],
      },
      {
        id: "login",
        title: "Signing in and passwords",
        audience: "everyone",
        summary: "Sign in with your email and password.",
        steps: [
          "Enter your email and password on the sign-in page.",
          "The eye button shows what you typed — useful for catching a typo before it costs you an attempt.",
        ],
        notes: [
          "If you forget your password, do not go looking for it in the sheet — only an encrypted hash is stored there, and it will not sign you in. Ask your Admin to reset it.",
          "A trailing space picked up while copying and pasting a password is a common cause of a failed sign-in.",
        ],
      },
      {
        id: "charts",
        title: "The Dashboard tab's charts",
        audience: "everyone",
        summary:
          "The Dashboard tab has a chart for each of your modules — only the ones you have access to.",
        notes: [
          "Change the period with the buttons at the top: Today, This week, This month, This year, All — or set your own range with From/To.",
          "Every chart carries its counts as well as its colours, so it can be read even when the colours cannot.",
          "Hovering a bar or a slice shows its exact value.",
        ],
      },
      {
        id: "dashboard",
        title: "Reading your dashboard",
        audience: "everyone",
        summary:
          "Three cards at the top — Pending Tasks, Completed Tasks and your MIS Score. Below them are tabs, shown according to what you have access to.",
        notes: [
          "The Overview tab shows your modules and your upcoming tasks.",
          "The Performance tab shows more than the score: it shows the full working, task by task.",
        ],
      },
      {
        id: "complete-task",
        title: "Completing your task",
        audience: "everyone",
        summary: "Marking a task assigned to you as done.",
        steps: [
          "Open your list in the Tasks tab (or Tasks in the top navigation).",
          "Press Complete on the task you have finished.",
          "Add a remark and attach proof if you want to.",
          "On save, the status is decided for you — before the due date it is 'Done on Time', after it is 'Delay Done'.",
        ],
        notes: [
          "Completing a task sends a WhatsApp confirmation to whoever assigned it.",
        ],
      },
      {
        id: "mis",
        title: "How the MIS score is built",
        audience: "everyone",
        summary:
          "Nobody types this score in — it is recalculated every time from the timestamps on your tasks. It is a penalty score: 0% is the best, −100% the worst.",
        how: [
          "Do not read it as a score to be increased — it is a count of what went wrong. If everything happens on time it comes to 0%, and 0% is as good as it gets.",
          "Each task earns a penalty: nothing if it was on time, half if it was late, and a full one if it never happened. Those are added up and divided by how many tasks counted.",
        ],
        steps: [
          "Completed before the due date = no penalty.",
          "Completed after the due date = half a penalty.",
          "Due date passed and the task still pending = a full penalty.",
          "Score = − (total penalty ÷ tasks evaluated) × 100.",
        ],
        example: {
          title: "The score across four tasks",
          lines: [
            "  Task 1   on time             penalty  0",
            "  Task 2   late                penalty  0.5",
            "  Task 3   never done          penalty  1",
            "  Task 4   on time             penalty  0",
            "                             ──────────",
            "  Total penalty                        1.5",
            "  Tasks evaluated                        4",
            "",
            "  Score = -(1.5 / 4) x 100  =  -38%",
          ],
        },
        notes: [
          "The score cannot go past −100% — one task can never cost more than one penalty, so the arithmetic does not allow it.",
          "A task that is not yet due does not count at all — neither for you nor against you.",
          "The Performance tab gives every task its own line: what happened, and what it cost.",
        ],
      },
    ],
  },

  {
    id: "delegation",
    title: "Task delegation",
    description: "For giving work to other people.",
    sections: [
      {
        id: "assign-task",
        title: "Assigning a task",
        audience: "TASK_DELEGATE",
        summary: "Giving a one-off task to somebody.",
        steps: [
          "Press Assign Task on the Tasks page.",
          "Choose the person — their department fills in automatically.",
          "Choose a priority (Low / Medium / High / Urgent).",
          "Write the task's title and description.",
          "Set the completion date and time — on-time or late is decided from this, to the minute.",
          "Attach a file if you need to, then save.",
        ],
        notes: [
          "Tasks you have given out appear under the 'Delegated by Me' tab.",
          "The due date carries a time, not just a date — 'today at 6pm' and 'today at 11:59pm' are not the same thing.",
        ],
      },
      {
        id: "recurring",
        title: "Creating a recurring task rule",
        audience: "RECURRING_ASSIGN",
        summary:
          "Set up a rule for work that repeats — its occurrences are then created automatically each day.",
        steps: [
          "Press Assign Recurring Task on the Tasks page.",
          "Set the doer, the frequency (Daily / Weekly / 15 Days / Monthly / Quarterly / Yearly), the task and the start date.",
          "Save. The rule becomes Active.",
          "Each night the system creates that rule's next occurrence as a new task.",
        ],
        notes: [
          "Each occurrence is its own task with its own due date — which is why each one's on-time or late result reaches the score separately.",
          "No occurrence is created on a date listed in the Holiday List sheet.",
          "Month ends are handled: a monthly rule set on the 31st does not land on a wrong date in February.",
        ],
      },
      {
        id: "pause-recurring",
        title: "Pausing a recurring rule and starting it again",
        audience: "RECURRING_ASSIGN",
        summary: "Pause the rule when the work needs to stop for a while.",
        steps: [
          "Tasks page → Recurring Rules tab.",
          "Switch off Active on the rule you want to stop.",
          "Switch it back on to resume.",
        ],
        notes: [
          "Pausing only stops new occurrences being created. Tasks already created stay as they are, and stay in the score.",
          "There is no need to delete a rule — pausing can be undone, deleting cannot.",
        ],
      },
    ],
  },

  {
    id: "inward",
    title: "Inward and quality check",
    description: "From material arriving to its pass or fail.",
    sections: [
      {
        id: "inward-entry",
        title: "Recording a new inward entry",
        audience: "INWARD_ENTRY",
        summary: "Recording material that has arrived.",
        steps: [
          "Press New Inward Entry on the Inward page.",
          "Enter the party name, invoice number and inward type (Raw Material / Consumable / Other).",
          "Attach the invoice or a photo, and add a remark.",
          "Save — the entry is created with its IQC status set to 'Pending'.",
        ],
      },
      {
        id: "iqc",
        title: "Running the quality check",
        audience: "IQC_CHECK",
        summary: "Verifying a pending entry and entering the pass and fail quantities.",
        steps: [
          "Press Quality Check on a pending entry, either on the Inward page or from the dashboard's 'Pending Quality Checks' card.",
          "Check the material against the invoice and tick the boxes.",
          "Enter the pass quantity and the fail quantity.",
          "A fail reason is required whenever there is a fail quantity.",
          "Save.",
        ],
        notes: [
          "Saving marks the entry 'Verified'.",
          "The fail quantity goes to the Failure Log sheet and the pass quantity to the IMS Inward sheet. If there is both, the entry goes to both — that is not a mistake, it is what should happen.",
        ],
      },
      {
        id: "quality-records",
        title: "Reading the Failure Log and IMS Inward",
        audience: "IMS_VIEW",
        summary: "Looking back at what the quality check decided.",
        steps: [
          "Failure Log tab on the Inward page — what was rejected, how much, and why.",
          "IMS Inward tab — what was accepted, and how much.",
        ],
        notes: [
          "Both carry a Linked Entry ID, which says which inward entry a row came from.",
        ],
      },
    ],
  },

  {
    id: "inventory-basics",
    title: "Inventory — understand this first",
    description:
      "Two ideas. Once they land, the rest of the IMS explains itself.",
    sections: [
      {
        id: "ledger-idea",
        title: "Stock is never written down — it is always added up",
        audience: "INVENTORY_VIEW",
        summary:
          "An item's stock is not a box that somebody edits. Every time material comes in, a line is written; every time it goes out, another line. The stock is the sum of those lines.",
        how: [
          "Think of your bank passbook. There is no separate 'balance' box that somebody adjusts by hand — every credit and debit has its own line, and the balance is their sum. The Stock Ledger works exactly the same way.",
          "The gain is that every figure can be explained. If the stock reads 1,249 today, it can be shown which entries built it — when it arrived, who brought it, which plan consumed it. A plain 'stock' box would show the number and never the reason.",
          "The second gain: this figure is never stale. No background job updates stock, so \"the job did not run and the stock is wrong\" simply cannot happen. Every time you look, it is added up fresh.",
        ],
        example: {
          title: "One item's ledger, and the stock it produces",
          lines: [
            "  Date         What happened        Qty       Balance",
            "  ─────────────────────────────────────────────────────",
            "  05 Aug   In   Opening stock       2,000       2,000",
            "  12 Aug   In   Indent receipt      3,000       5,000",
            "  18 Aug   Out  Sample taken           -50      4,950",
            "  20 Aug   Out  Production PLAN-9N  -3,800      1,150",
            "                                              ───────",
            "                                    Stock =    1,150",
          ],
        },
        notes: [
          "No line is ever erased from the ledger. A mistake is corrected with an opposite entry, so the old record stays readable exactly as it was.",
          "Every Out line also records why the material left — sample, production or manual. That is what saves you hunting for \"where did the material go?\" at the end of the month.",
        ],
      },
      {
        id: "three-numbers",
        title: "Three figures: On Hand, Free and Projected",
        audience: "INVENTORY_VIEW",
        summary:
          "Stock is not one figure but three, and they mean different things. Most mistakes come from treating them as the same.",
        how: [
          "On Hand — what is physically in the store right now. It can be counted by hand.",
          "Committed — material that is there, but which a production plan has already reserved. It belongs to that plan, even though nobody has picked it up yet.",
          "Free — On Hand minus Committed. This is the figure you can safely promise new work against. Everywhere in the system that decides \"how much is there?\", it reads Free, never On Hand.",
          "In Transit — ordered and paid for, but not yet arrived.",
          "Projected — Free plus In Transit. It says what the position will be once the material lands. Reorder reads this one, so that something already on its way is not ordered twice.",
        ],
        example: {
          title: "One item, three different answers",
          lines: [
            "  Sitting in the store          1,250     <- On Hand",
            "  Reserved by a plan            1,050     <- Committed",
            "                             ────────",
            "  Left for new work               200     <- Free",
            "",
            "  Ordered, on its way             500     <- In Transit",
            "                             ────────",
            "  Position once it lands          700     <- Projected",
          ],
        },
        notes: [
          "Seeing 1,250 and promising somebody 1,000 is exactly the mistake the Free figure prevents. Of that 1,250, some 1,050 already belongs to somebody else.",
          "Free can go negative. That means plans have reserved more than exists — it is shown rather than hidden, because hiding it only makes the problem bigger later.",
        ],
      },
    ],
  },

  {
    id: "inventory",
    title: "Inventory (IMS)",
    description: "From creating an item through to stock, reorder and indents.",
    sections: [
      {
        id: "item-master",
        title: "Creating an item",
        audience: "INVENTORY_SETUP",
        summary:
          "Anything you want to hold stock of has to be created as an item once.",
        steps: [
          "Press New Item on the Inventory page.",
          "Enter the SKU — this item's identifying code, such as RM-SCREW-8X40.",
          "Enter the full name, the category (Raw Material or Consumable) and the size/unit.",
          "Choose the UOM — the unit this thing is measured in (PCS, KG, MTR...).",
          "Fill in the rate and location if you know them.",
          "Save.",
        ],
        notes: [
          "The SKU is this item's identity. Once created it should not be changed, nor reused for something else — the entire past record hangs off it.",
          "Choose the UOM carefully. BOMs, plans and indents all run in it from here on. A thing measured in PCS cannot have its BOM written in KG; the system refuses.",
          "Location is only a label — writing it does not make stock count separately per place. That is deliberate; there is one pool for now.",
          "Rate is informational for now; no calculation uses it.",
        ],
      },
      {
        id: "stock-in-out",
        title: "Recording stock in and out",
        audience: "INVENTORY_TXN",
        summary: "Material arrived or material issued — both get an entry.",
        steps: [
          "Press Stock In / Out against the item on the Inventory page.",
          "Choose the direction — In (arrived) or Out (issued).",
          "Enter the quantity. Fractions are fine, such as 1.5 or 0.25.",
          "Choose the source (Opening, Manual, Adjustment...), and add Issued To and a remark if you want.",
          "Save — a new ledger line is written and the stock changes immediately.",
        ],
        notes: [
          "Issuing more than the free stock is refused, not merely warned about. The reason: stock going negative is always the sign of a mistake — either a typo, or an opening balance that was never entered. Both are cheap to fix at the moment of entry and expensive to untangle weeks later.",
          "The refusal is measured against Free, not On Hand. Material a plan has reserved cannot be issued out from under it.",
          "The very first entry is usually an 'Opening' — enter what is in the store today, once. The system carries on from there.",
        ],
      },
      {
        id: "item-detail",
        title: "Seeing one item's full history",
        audience: "INVENTORY_VIEW",
        summary:
          "Clicking an item's name shows every entry against it, and the balance after each one.",
        notes: [
          "Today's stock at the top, every movement below it, newest first.",
          "Each line carries the balance as it stood at that moment, so \"when did the stock drop?\" is answered by scrolling.",
          "Material issued to production carries its Plan ID, and material received against an indent carries its Indent ID. Every figure can be traced to its source.",
        ],
      },
      {
        id: "planning-fields",
        title: "The five planning figures",
        audience: "INVENTORY_SETUP",
        summary:
          "Fill these five in and the system starts telling you what to order, when, and how much. Leave them out and you still get stock, but no advice.",
        how: [
          "ADC (Average Daily Consumption) — how much is used per day. The system works this out from the last 30 days of Out movements. If you enter it yourself, yours is used — a new item has no past consumption to learn from.",
          "Lead Time (days) — how many days pass between placing an order and the material arriving. Ask the supplier and enter the truth; the advice is only as good as this figure.",
          "Safety Factor — the buffer. 1.5 means \"keep one and a half times what is needed\", so that a late supplier or a sudden rise in use does not stop the work.",
          "MOQ (Minimum Order Quantity) — the supplier will not sell less than this. The system will never raise an indent below it.",
          "Max Level — holding more than this is money tied up. When raising an indent the system tops up to here, and no further.",
        ],
        notes: [
          "These five are the whole brain of reorder. Without them an item reads 'Not Set Up' — the system stays quiet on purpose, because guessing from incomplete data is worse than giving no advice.",
          "One common mistake: setting Max Level very low (say 5) while the MOQ is high (say 300). Every item then reads 'Overstock' for ever and reorder never suggests anything. Always keep Max Level comfortably above the MOQ.",
        ],
      },
      {
        id: "bulk-setup",
        title: "Bulk Setup — filling many items at once",
        audience: "INVENTORY_SETUP",
        summary:
          "Filling the planning figures for a hundred items one at a time is long work. Bulk Setup puts them all on one screen and saves them in a single go.",
        steps: [
          "Open Inventory → Bulk Setup.",
          "Type the figures straight into the cells.",
          "Press Save All.",
        ],
        notes: [
          "Only the cells you actually touched are written. So if somebody changed an item's name or category in the meantime, your save does not wipe it.",
          "Everything goes in one request, so filling a hundred items puts no extra strain on Google's limits.",
        ],
      },
      {
        id: "stock-status",
        title: "What an item's status is telling you",
        audience: "INVENTORY_VIEW",
        summary:
          "Every item carries a status. Nobody writes it — it comes from comparing Free stock against the reorder point.",
        how: [
          "Out of Stock — free stock is gone. Work can stop now.",
          "Critical — free stock has reached the reorder point. Order today.",
          "Low — within one and a half times the reorder point. Keep an eye on it.",
          "Healthy — comfortably stocked.",
          "Overstock — above the Max Level. Money is tied up.",
          "Not Set Up — the planning figures were never filled in, so the system cannot say anything.",
        ],
        notes: [
          "'Not Set Up' is not an error — it is the system answering honestly: \"I do not know this item's lead time or max level, so I will not guess.\"",
        ],
      },
      {
        id: "reorder",
        title: "Reorder — when to place an order",
        audience: "INVENTORY_VIEW",
        summary:
          "The Reorder page says which items are close to running out, and how much to order.",
        how: [
          "The reorder point means: \"once stock falls to this, order now, or it will run out before the new material arrives.\"",
          "The arithmetic is simple — daily use × days the material takes to arrive × a safety buffer. In other words, whatever will be consumed in the meantime should always already be on the shelf.",
          "The comparison uses Projected stock, not Free. The reason is plain: ordering something that has already been ordered and is on its way means paying for it twice.",
        ],
        example: {
          title: "One item's reorder point",
          lines: [
            "  Daily use (ADC)                  90 PCS",
            "  Supplier lead time                7 days",
            "  Safety factor                   1.5",
            "                                ────────",
            "  Reorder point = 90 x 7 x 1.5    945 PCS",
            "",
            "  Projected stock now             700 PCS",
            "  700 < 945  ->  time to order",
          ],
        },
        notes: [
          "An item whose reorder point cannot be worked out (its planning figures are blank) never appears in this list — staying quiet beats giving wrong advice.",
          "The item at the top of the list is the one that has fallen furthest below its own reorder point, not the one with the largest quantity.",
        ],
      },
      {
        id: "indent-qty",
        title: "How the indent quantity is decided",
        audience: "INVENTORY_VIEW",
        summary:
          "The system suggests a quantity, but it is only a suggestion — you can change it.",
        how: [
          "First it looks at the shortfall. Then at how much would be needed to top up to the Max Level. It takes the larger of the two — covering only the shortfall would have you ordering again next week.",
          "That figure is then never allowed below the MOQ, and is rounded up to a whole multiple of it, because that is how the supplier sells.",
        ],
        example: {
          title: "How the quantity is arrived at",
          lines: [
            "  Shortfall                     200 PCS",
            "  To top up to Max Level        640 PCS   <- the larger",
            "  MOQ                           500 PCS",
            "                              ─────────",
            "  640 rounded up to a multiple 1,000 PCS  <- suggested",
            "",
            "  You can change this on screen.",
          ],
        },
      },
      {
        id: "indents",
        title: "An indent from start to finish",
        audience: "INDENT_APPROVE",
        summary:
          "An indent is a purchase request. It passes through a few stages between being raised and the material arriving.",
        how: [
          "Pending — the request exists, nobody has approved it yet.",
          "Approved — approved, ready to be ordered.",
          "Ordered — the order has gone to the supplier.",
          "Partially Received — some has arrived, some is outstanding.",
          "Received — all of it has arrived.",
          "Cancelled — the request was dropped.",
        ],
        steps: [
          "On the Reorder page pick the item, adjust the quantity if you want, and raise the indent.",
          "Approve it on the Indents page.",
          "Mark it Ordered once the order has gone out.",
          "Press Receive when the material arrives and enter the quantity received.",
        ],
        notes: [
          "Receiving writes the stock In for you — there is no separate stock entry to make. \"Marked it received, now remember to add the stock\" is precisely the step people forget, so it was made one action.",
          "A Pending indent does not count as in transit. The reason: if an unapproved request counted, one forgotten request would hide a genuine need to reorder. It starts counting the moment it is approved.",
          "A part delivery still raises the stock immediately, and the remainder stays in transit.",
        ],
      },
      {
        id: "iqc-to-stock",
        title: "How a passed quality check raises stock",
        audience: "IQC_CHECK",
        summary:
          "When an inward entry passes its quality check, the passed quantity is added to stock automatically.",
        how: [
          "When material arrives an inward entry is created first — but that is not stock yet, because it has still to be checked.",
          "Whatever quantity passes the quality check becomes a stock In automatically. The failed quantity goes to the Failure Log, not into stock.",
          "That stock In line carries the inward entry's ID, so it can later be asked which delivery this material came from.",
        ],
        notes: [
          "The item's SKU has to be filled in on the inward entry — without it the system has no way of knowing whose stock to raise.",
        ],
      },
    ],
  },

  {
    id: "bom",
    title: "BOM — what a product is made from",
    description: "Writing down what goes into a product, and how much.",
    sections: [
      {
        id: "bom-idea",
        title: "What a BOM is",
        audience: "BOM_MANAGE",
        summary:
          "BOM stands for Bill of Materials — a product's recipe. How much of which item goes into one unit, and nothing more.",
        how: [
          "Just as a loaf takes so much flour and so much water, a door takes so many screws and so much tape. A BOM records the amount for one unit, not for a whole order.",
          "Once written, the system does the multiplying. Plan 100 doors and it works out that 1,600 screws are needed — you never reach for a calculator.",
          "This is why a BOM has to be right. Production planning, the shortage arithmetic and every indent that follows all stand on this one table.",
        ],
        example: {
          title: "A BOM, and what it is used for",
          lines: [
            "  BOM: Sliding Door 80mm",
            "    SS 304 Screw 8x40    16 PCS  per unit",
            "    Tape 2 inch           2 PCS  per unit",
            "",
            "  Plan 100 doors and that becomes:",
            "    Screws  16 x 100  =  1,600 PCS",
            "    Tape     2 x 100  =    200 PCS",
          ],
        },
      },
      {
        id: "bom-create",
        title: "Creating a product's BOM",
        audience: "BOM_MANAGE",
        summary: "How much of which item goes into making one product.",
        steps: [
          "Press New BOM on the BOM page.",
          "Type the product's name — the SKU is generated for you, and you can change it.",
          "Add as many rows as you need.",
          "Pick an item on each row and enter the quantity for one unit.",
          "Press Create BOM.",
        ],
        notes: [
          "Choosing an item fills in its SKU and unit automatically — a BOM can only carry the unit the item itself is measured in, so a PCS item can never be written in KG by accident.",
          "Quantities can be fractional — 1.5 or 0.25 are fine.",
          "Putting the same item on two rows is refused, and the item is named. The reason: silently adding 12 and 4 into 16 looks perfectly correct, and that mistake becomes impossible to spot afterwards. Put the whole quantity on one line.",
          "The product SKU is generated from the name, so 'Sliding Door 80mm' becomes FG-SLIDING-DOOR-80MM. Change it if you have your own coding scheme.",
        ],
      },
      {
        id: "bom-versions",
        title: "Changing a BOM — where the old one goes",
        audience: "BOM_MANAGE",
        summary:
          "Saving a product's BOM again creates a new version and archives the old one — it is not erased.",
        how: [
          "Suppose it used to take 12 screws, the design changed, and now it takes 16. You save the new BOM: it becomes v2, and v1 is archived and still readable.",
          "This matters because three months later a complaint about some batch raises the question \"what went into it at the time?\". Had the old BOM been written over, there would be no answer left.",
          "Existing plans are unaffected either way — each plan keeps its own copy of the BOM (see the next section).",
        ],
        notes: [
          "Press 'Older versions' on the BOM page to read the previous ones.",
          "A product's SKU does not change between versions — otherwise one product would split into two identities.",
        ],
      },
    ],
  },

  {
    id: "ppc",
    title: "PPC — production planning",
    description:
      "What to make, when to make it, whether the material is there, and who it is reserved for.",
    sections: [
      {
        id: "ppc-idea",
        title: "How PPC works — the part that matters most",
        audience: "PPC_PLAN",
        summary:
          "When you plan several products together, the system does not check them one at a time — it shares out one common pool of stock between them. This is the heart of the module.",
        how: [
          "Picture 100 screws in the store. You need to make two products — one takes 80 screws, the other 60.",
          "Check them separately and the first reads \"80 needed out of 100 — fine\", and so does the second: \"60 needed out of 100 — fine\". Both get a green light. But together they want 140 and only 100 exist. This mistake never shows up on paper; it shows up on the production floor, when the material runs out.",
          "So the system treats stock as one pool and hands it out from there. Whichever has the earlier production date gets it first — that is what will be built first; something three weeks out can wait for an indent to arrive.",
          "After the sharing out, each product still carries its own status — one can be Ready and the other Shortage. The totals stay honest and each product's own picture stays clear.",
        ],
        example: {
          title: "100 screws, two products — the wrong way and the right way",
          lines: [
            "  WRONG (each product checked on its own):",
            "    Product A   needs 80   stock 100   -> Ready",
            "    Product B   needs 60   stock 100   -> Ready",
            "    Both Ready. But 80+60 = 140 and only 100 exist.",
            "",
            "  RIGHT (shared out from one pool):",
            "    Product A   22 Aug   needs 80   gets 80   -> Ready",
            "    Product B   25 Aug   needs 60   gets 20   -> Shortage 40",
            "    A is built first, so A is served first.",
            "    Raise an indent for B's 40.",
          ],
        },
        notes: [
          "This is why products being made together should go into one plan. Entering them separately is not wrong either — whatever was planned first has already reserved its material — but entering them together shows you the whole picture up front.",
          "When two products share a production date, whichever was selected first is served first.",
        ],
      },
      {
        id: "ppc-reserve",
        title: "Reserving — material is held the moment a plan is made",
        audience: "PPC_PLAN",
        summary:
          "As soon as a plan is created, whatever material it got belongs to it. The rest of the system stops seeing that stock.",
        how: [
          "Reserved means the material is still physically in the store, but it no longer counts as free for anything else.",
          "The effect is immediate everywhere: free stock drops on the Inventory page, the reorder page treats it as a shortfall and starts suggesting an order, and the next plan cannot take it.",
          "This is why there is no unreserved draft state for a plan. Such a draft would read \"Ready\" while holding nothing, and a second plan would be built on the same stock — precisely the mistake this design exists to prevent.",
          "A plan is created even when material is short. Whatever it did get is reserved, and the rest shows as a shortage. That is deliberate too: the material this plan has already been given belongs to it, or the next plan would take it and this plan's shortage would quietly grow.",
        ],
        notes: [
          "Cancelling a plan releases the whole reservation at once. Nothing is written to the ledger, because the material was never actually issued.",
        ],
      },
      {
        id: "ppc-plan",
        title: "Creating a production plan",
        audience: "PPC_PLAN",
        summary:
          "The plan for what is to be made, and the material reserved against it.",
        steps: [
          "Press New Plan on the PPC page.",
          "Enter every product being made together in one go — product, quantity and production date.",
          "Press Check material to see what is short, product by product.",
          "Press Create plan.",
        ],
        notes: [
          "'Check material' only shows; it writes nothing. It runs exactly the same calculation that creating the plan will run, so what you see is what you get.",
          "Only products with an active BOM can be planned.",
          "Each product becomes its own plan, because production starts and finishes per product. The material, though, is shared out across all of them at once.",
        ],
      },
      {
        id: "ppc-snapshot",
        title: "A plan keeps its own copy of the BOM",
        audience: "PPC_PLAN",
        summary:
          "When a plan is created, a copy of that product's BOM is written with it. Changing the BOM later does not change an existing plan.",
        how: [
          "Suppose on 20 August you planned 100 doors when the BOM said 16 screws. On 25 August the design changed and the BOM became 18.",
          "If the plan read its figures from the BOM each time, that old plan would suddenly be asking for 1,800 screws — when it was built on 1,600 and had reserved material accordingly. The whole record would rewrite itself.",
          "So the plan keeps its own copy. Old plans stay exactly as they were; new plans are built on the new BOM.",
        ],
        notes: [
          "Press 'Material' on a plan to see that copy, along with the BOM version it came from.",
        ],
      },
      {
        id: "ppc-shortage",
        title: "What to do when material is short",
        audience: "PPC_PLAN",
        summary:
          "A plan with a shortage is not stuck — it holds what it was given, and the rest can be arranged.",
        steps: [
          "Press 'Material' on the plan to see which item is short and by how much.",
          "Raise an indent for that item from the Reorder or Indents page and get it approved.",
          "Receive the indent when the material arrives — the stock rises automatically.",
          "Come back to PPC and press 'Check again' on the plan.",
        ],
        notes: [
          "Without 'Check again' a plan stays short for ever, even after the material arrives. The button re-weighs the plan against today's stock and adds whatever it can now get.",
          "Checking again only fills this plan's own gap. It cannot touch material another plan has reserved.",
          "An indent raised from a shortage is for exactly the amount short and is not rounded up to the MOQ — you can change the quantity yourself.",
        ],
      },
      {
        id: "ppc-start",
        title: "Starting production",
        audience: "INVENTORY_TXN",
        summary:
          "Entering the actual quantity and issuing the material — this is the moment stock really falls.",
        how: [
          "Creating the plan only held the material; it did not consume it. It is consumed now, when production actually starts.",
          "The system asks how many units are really being made rather than assuming the planned figure. If the plan was for 400 and only 380 were made, only 380 worth of material should leave. Taking the planned figure instead lets stock drift away from what is really on the shelf.",
          "The material held for the units that were not made is released immediately, so it can be used elsewhere rather than sitting idle until next month.",
        ],
        steps: [
          "Press Start production against the plan on the PPC page.",
          "Enter how many units are actually being made.",
          "Press Issue material.",
          "Press Complete when the work is finished.",
        ],
        example: {
          title: "Planned 400, made 380",
          lines: [
            "  10 screws per unit",
            "  Planned          400 units  ->  4,000 screws reserved",
            "  Actually made    380 units",
            "",
            "  Issued (Out)     380 x 10  =  3,800 screws",
            "  Released                       200 screws",
            "                                 (held for the 20 not made)",
          ],
        },
        notes: [
          "Every material is checked before any of it is issued. If even one falls short, nothing is written and the whole action stops — so a plan can never be left half consumed.",
          "Each issue becomes an Out line in the Stock Ledger carrying the Plan ID, so it can later be asked which production run used this material.",
        ],
      },
    ],
  },

  {
    id: "team",
    title: "Team",
    description: "For seeing other people's work.",
    sections: [
      {
        id: "performance",
        title: "Seeing the team's performance",
        audience: "PERFORMANCE_VIEW",
        summary:
          "The whole team's scores in one place — worst at the top, so attention goes where it is needed.",
        steps: [
          "Open the Performance section lower down the Dashboard tab.",
          "Choose the period at the top — today, week, month, year, or your own range.",
          "Press Excel export to download exactly the list on screen.",
        ],
        notes: [
          "0% to −20% is fine, −21% to −50% deserves attention, below −50% is poor.",
          "Each person carries their On Time, Delay and Not Done breakdown — not just the final number.",
          "This is the same arithmetic each person sees on their own dashboard, so the figures never disagree.",
          "The export covers the period selected on screen. The file is a .csv, which opens directly in Excel.",
        ],
      },
    ],
  },

  {
    id: "admin-setup",
    title: "Setting the whole system up",
    description:
      "For the organization's Admin only — the full path to standing the system up for the first time.",
    sections: [
      {
        id: "how-it-works",
        title: "How the system works",
        audience: "admin",
        summary:
          "All of your organization's data lives in your own Google Sheets. Pro ERP reads and writes them through a service account, which is why every sheet has to be shared with that service account.",
        notes: [
          "Every module has its own Google Sheet. You do not need to create the header rows — the system writes them the first time it saves.",
          "If you remove our access from a sheet, that module stops working there and then.",
        ],
      },
      {
        id: "connect-sheets",
        title: "Connecting the module sheets",
        audience: "admin",
        summary:
          "Create a blank Google Sheet for each module and paste its URL.",
        steps: [
          "Create a folder in Google Drive and share it with the service account email, with Editor access (the address is on the Settings page).",
          "Create a blank sheet inside that folder for each module — the full list is below.",
          "Sharing the folder gives access to every sheet inside it, so there is no need to share each sheet separately.",
          "Paste each URL against its module under Admin → Settings and save.",
        ],
        example: {
          title: "Which sheet is for what",
          lines: [
            "  Tasks                  one-off tasks",
            "  Recurring Tasks        rules for repeating work",
            "  Holiday List           dates that are holidays",
            "  Inward & IQC FMS       incoming material + quality check",
            "  Failure Log            what failed the quality check",
            "  IMS Inward             what passed",
            "",
            "  Items                  item master (SKU, UOM, planning)",
            "  Stock Ledger           every In / Out line — stock comes from this",
            "  Indents                purchase requests",
            "  BOM                    a product's recipe",
            "  Production Plans       what to make, how much, when",
            "  Plan Materials         each plan's BOM copy + reservation",
          ],
        },
        notes: [
          "There is no need to create every sheet at once. Connect the ones for the modules you are actually using — the rest can be added later.",
          "Inventory needs both Items and Stock Ledger to work. PPC needs both Production Plans and Plan Materials — one alone is not enough.",
          "You do not need to write the header row. The system creates it on the first write, and adds any new column later in the same way.",
          "On save the system checks straight away whether it can reach the sheet, so a mistake is caught there and then.",
          "Put the dates in the Holiday List in YYYY-MM-DD format as plain text (format the column as Plain Text, or prefix each entry with '). Otherwise Google rewrites them into its own format and they stop matching.",
        ],
      },
      {
        id: "attachments",
        title: "The folder for attachments",
        audience: "admin",
        summary: "Where the files attached to tasks and inward entries go.",
        steps: [
          "Paste your folder's URL under Admin → Settings, in File Storage (Drive Folder).",
          "On save the system uploads a test file and tells you immediately whether the folder will work.",
        ],
        notes: [
          "Required: the folder has to be inside a Shared Drive (which only Google Workspace accounts have), and the service account needs Content Manager access.",
          "A folder in a personal 'My Drive' will not work — Google does not let a service account store files in a personal Drive at all. That is Google's rule, not a shortcoming of ours.",
          "If you do not connect a Drive folder, or it does not work, files go to the platform's own storage instead. Your work is never blocked either way.",
        ],
      },
      {
        id: "users",
        title: "Creating users and granting access",
        audience: "admin",
        summary:
          "When creating a person, decide which parts of the system they will work in.",
        steps: [
          "Admin → Users → Add User.",
          "Enter the name, email, password, role, department and WhatsApp number.",
          "Tick the modules that person needs under System Access.",
          "Create the user, and send them the password.",
        ],
        notes: [
          "Role and access are two different things. The role says whether somebody is an Admin; access says which module they work in. Letting somebody assign tasks no longer means making them an Admin — it is just a checkbox.",
          "An Admin holds access to every module automatically.",
          "The modules you tick are the ones that appear as tabs on that person's dashboard.",
          "If a password is forgotten, set a new one from Manage → Reset Password. The old one can never be read back.",
        ],
      },
      {
        id: "whatsapp",
        title: "Connecting WhatsApp (ChatXFlow)",
        audience: "admin",
        summary:
          "For sending task confirmations and daily reminders over WhatsApp.",
        steps: [
          "Connect your WhatsApp number at chatxflow.online and get the Developer API token.",
          "Enter the token, number and base URL under Admin → Settings → WhatsApp, and save.",
          "Press Send Test Message — a real message should arrive on your number.",
        ],
        notes: [
          "Two things happen automatically: a confirmation to whoever assigned a task when it is completed, and a daily list of pending tasks to everybody.",
          "Reminders go to the number in the person's profile, so enter the right WhatsApp number when creating users.",
          "If a message does not arrive, first check at chatxflow.online that your WhatsApp session is still connected.",
        ],
      },
      {
        id: "automation",
        title: "What runs on its own each day",
        audience: "admin",
        summary: "Two jobs run every night and morning without anybody doing anything.",
        notes: [
          "The next occurrences of recurring rules are created, skipping holidays.",
          "Everybody gets a WhatsApp reminder of their pending tasks.",
          "Both run once a day, and running twice does not create duplicates.",
          "You can also send immediately yourself with 'Send Reminders Now' on the Settings page.",
        ],
      },
      {
        id: "troubleshooting",
        title: "When something does not work",
        audience: "admin",
        summary: "Common problems and the first thing to try.",
        notes: [
          "\"Sheet is not configured\" — that module's URL has not been pasted under Settings yet.",
          "\"Could not reach\" — the sheet or folder was never shared with the service account, or the sharing was removed.",
          "Somebody cannot sign in — do not have them copy the password from the sheet (that is a hash). Give them a new one with Reset Password.",
          "Somebody sees no tabs at all — nothing is ticked under their System Access.",
          "WhatsApp is not sending — check with Send Test Message under Settings, then check the ChatXFlow session.",
        ],
      },
    ],
  },

  {
    id: "platform",
    title: "Platform operations",
    description: "For the platform operator only — running the whole install.",
    sections: [
      {
        id: "onboarding",
        title: "How a new organization joins",
        audience: "platform",
        summary:
          "Any organization can sign itself up — there is nothing for you to do.",
        steps: [
          "They go to /signup and create a blank Google Sheet.",
          "They share that sheet with the service account, with Editor access.",
          "They enter the organization's name, their own admin account and the sheet's URL.",
          "The system creates the Users and Settings tabs in that sheet, registers the organization, makes them an Admin and signs them in.",
        ],
        notes: [
          "One sheet cannot serve two organizations, and one email can exist only once across the whole platform — sign-in asks only for an email, so it has to be unique.",
        ],
      },
      {
        id: "suspend",
        title: "Suspending an organization",
        audience: "platform",
        summary: "Stopping an organization from the Platform page.",
        steps: ["Switch off Active against that organization on the Platform page."],
        notes: [
          "All of its users are signed out on their next request, and its automated jobs stop too.",
          "Nothing is deleted — not the data, not the sheets, not the users. Switching it back on returns everything to how it was.",
        ],
      },
      {
        id: "health",
        title: "Checking the deployment",
        audience: "platform",
        summary:
          "Opening /api/health shows which version is live and which settings are present.",
        notes: [
          "The commit says whether the current code actually deployed — this is where \"I pushed it, did it go out?\" is answered.",
          "Under configured, each required setting reads true or false. Its value is never shown, only whether it exists.",
        ],
      },
      {
        id: "limits",
        title: "What to keep in mind",
        audience: "platform",
        summary: "This install's real limits.",
        notes: [
          "Every organization runs through one Google service account, and Google's request limit applies to that whole project rather than per organization. With many organizations running at once, this bites first.",
          "If two people edit the very same record at exactly the same moment, one of the changes can be lost. Different people doing their own work is not a problem.",
          "File uploads are capped at 4MB.",
          "The automated jobs run once a day.",
        ],
      },
    ],
  },
];
