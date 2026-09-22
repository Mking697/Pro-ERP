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
          "This is the system that runs your organization's work — task delegation, recurring jobs, material inward and quality checks, inventory and stock, product BOMs, production planning, and everybody's performance scoring. Your data is fully isolated to your own organization — another organization's data is never visible to you.",
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
        id: "nav-groups",
        title: "The top nav bar — MDO, PMS, Stock, FMS, Others",
        audience: "everyone",
        summary:
          "The top menu is now grouped, so day-to-day links and setup links never sit mixed together.",
        how: [
          "MDO (day-to-day work) — Tasks, Flow (your FMS steps), Leave, Reports, and Performance if you have access.",
          "PMS (production) — BOM, PPC, and every FMS Line a production plan actually runs.",
          "Stock — Inventory (raw material/consumable) and Finished Goods, kept separate.",
          "FMS — Inward, Purchase, and every other flow that isn't a production Line.",
          "Others — Vendors/Customers, Users, Settings, and (for a platform operator) Platform.",
        ],
        notes: [
          "A group only shows the links you actually have access to — an empty group doesn't show at all.",
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
      {
        id: "whats-new",
        title: "The header bell — What's new",
        audience: "everyone",
        summary:
          "The bell icon next to Settings in the header shows what has recently shipped in the system.",
        notes: [
          "A small number appears on the bell whenever there's an update you haven't seen yet.",
          "Opening the bell marks everything as seen — the number won't come back until something new ships.",
          "This is only remembered on this browser — opening the app on another device or browser may show the same updates as 'new' again.",
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
          "Type the party name — pick it from the list if it's a registered vendor, or just type a new name. Also enter the invoice number and inward type (Raw Material / Consumable / Other).",
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
        id: "bulk-import-items",
        title: "Creating many new items at once",
        audience: "INVENTORY_SETUP",
        summary:
          "Creating items one at a time doesn't scale for a long list — Bulk Import creates them all in one go from an Excel/CSV file.",
        steps: [
          "Press Bulk Import on the Inventory page.",
          "Download Template — it has the same columns as the New Item form.",
          "Remove the template's example row, fill in your data in the same format, then save the file (CSV or Excel both work).",
          "Upload that same file back in the Bulk Import dialog and press Import.",
        ],
        notes: [
          "SKU can be left blank — just like the New Item form, one is generated for you.",
          "The template also has an 'Opening Stock' column the New Item form doesn't have — fill in a quantity there and that item's stock is created right away as one 'Opening' entry, with no separate Stock In needed.",
          "If a row has a problem (blank name, an invalid category, or a SKU that already exists), only that row is skipped and the reason is shown — every other item is still created.",
          "Column headers can be slightly off in spelling or spacing (e.g. 'Item_Name' or 'Item Name' both work), but the easiest path is still the one the template gives you.",
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
      {
        id: "fg-inventory",
        title: "Finished Goods have their own home",
        audience: "INVENTORY_VIEW",
        summary:
          "The Stock group has two separate boards, Inventory and Finished Goods — so finished product never sits mixed in with raw material or consumables.",
        how: [
          "Both use exactly the same ledger — the only thing that decides which board an item shows on is whether its Category is 'FG'.",
          "The main Inventory page now leaves FG out entirely. The FG page (/inventory/fg) shows only FG, and creating a New Item from there pre-selects Category 'FG' automatically.",
          "The FG stock a completed production run creates (from PPC's 'ppc-start' step, or from an FMS Production Line's final-step Action) lands and shows up on this same FG board.",
        ],
      },
    ],
  },

  {
    id: "parties",
    title: "Purchase Vendor & Customer Master",
    description: "Vendor and customer master data — every future PO and sales order will hang off this.",
    sections: [
      {
        id: "parties-idea",
        title: "This form is for Purchase Vendors only",
        audience: "PARTY_MASTER",
        summary:
          "What you create here today is a 'Purchase Vendor' — someone you buy material from. Other vendor types, like an OEM or Manufacturing Vendor, may be added later, which is why the name is deliberately specific.",
        notes: [
          "A duplicate name (ignoring case and spacing) doesn't get blocked, only warned about — whether it matches an existing row or another row in the same import file.",
        ],
      },
      {
        id: "vendor-create",
        title: "Creating a Purchase Vendor",
        audience: "PARTY_MASTER",
        summary: "A vendor's master record.",
        steps: [
          "Vendors/Customers page → Purchase Vendors tab → press '+ Add'.",
          "Fill in the vendor's name and contact details.",
          "Save.",
        ],
        notes: [
          "For creating many vendors at once, use Bulk Import (Excel/CSV, the same download-template-fill-upload pattern as Items).",
        ],
      },
      {
        id: "vendor-items",
        title: "Linking a vendor to an item — lead time and price",
        audience: "PARTY_MASTER",
        summary:
          "Which items a vendor supplies, in how many days (lead time), and at what price — creating this link is what lets Purchase FMS and reorder actually use it.",
        steps: [
          "Press 'Items' against the vendor.",
          "Choose the item, and fill in its Lead Time (days) and Unit Price.",
          "Save — saving the same vendor-item pair again updates the existing figures rather than creating a new row.",
        ],
        notes: [
          "When an indent is raised for an item, every vendor linked to it is suggested — cheapest (by last price) first. A vendor with no price filled in sorts to the bottom.",
          "The PO Issue screen relies on this same link — an item's indent will never be suggested against a vendor until that item is linked to it.",
        ],
      },
      {
        id: "customer-create",
        title: "Creating a Customer",
        audience: "PARTY_MASTER",
        summary: "A customer's master record — the future Sales chain will hang off this.",
        steps: [
          "Vendors/Customers page → Customers tab → press '+ Add'.",
          "Fill in the name and contact details, then save.",
        ],
        notes: ["Customers have their own Bulk Import too, same as Vendors."],
      },
    ],
  },

  {
    id: "purchase",
    title: "Purchase (from Indent to material arriving)",
    description:
      "A flow that starts itself the moment an indent is approved — PO Issue, Follow Up, and Material Received.",
    sections: [
      {
        id: "purchase-idea",
        title: "How the Purchase flow works",
        audience: "PURCHASE_FMS",
        summary:
          "The moment an indent is approved, this flow starts on its own — nobody has to start it by hand.",
        how: [
          "Step 1 — Indent Approve: this happens on Inventory's own Indents page (see the indent-approve section) — this is what triggers the whole flow.",
          "Step 2 — PO Issue: choose a vendor and every Approved indent linked to that vendor is suggested at once — several items can be bundled into a single PO.",
          "Step 3 — Follow Up: an actual, actionable step for chasing the vendor after the PO. Its deadline is worked out from the vendor's own Lead Time (one day before it), so a reminder lands before the material is actually due.",
          "Step 4 — Material Received: enter the invoice and each item's quantity (full or partial) to receive the material — this reuses the exact same receive logic an Indent's own Receive step uses, so stock updates correctly right away.",
        ],
        notes: [
          "This is an FMS-style flow, but it isn't built with the generic Template builder — these four steps are fixed, so each one has its own dedicated screen.",
        ],
      },
      {
        id: "purchase-setup",
        title: "Purchase Setup — each step's Doer and TAT",
        audience: "admin",
        summary:
          "Admin → Settings → Purchase Setup decides who each step goes to and how many days/hours it should take.",
        steps: [
          "Open Admin → Settings and find the Purchase Setup section.",
          "Fill in a Doer and TAT for Step 1 (PO Issue) and Step 2 (Follow Up).",
          "Fill in only a Doer for Step 3 (Material Received) — its TAT is worked out from the vendor's own Lead Time, there's nothing to enter.",
          "Save.",
        ],
        notes: [
          "If this is left unset, the flow still runs once an indent is approved — a default is used for TAT, but filling this in gives better advice.",
        ],
      },
      {
        id: "purchase-po-issue",
        title: "Issuing a PO",
        audience: "PURCHASE_FMS",
        summary: "Choose a vendor and bundle all its pending indents into one PO.",
        steps: [
          "Purchase page → PO Issue tab.",
          "Choose a vendor — every Approved indent linked to that vendor is ticked automatically, with its last price shown.",
          "Untick anything not needed, and change the New Price where required.",
          "Attach the PO/quotation and press 'Issue PO'.",
        ],
        notes: [
          "An item with no vendor link at all will never appear against any vendor here — link it to that vendor from Parties first.",
          "Whatever New Price is entered here becomes this PO's own record — the Old Price (the vendor link's last price) is always shown alongside it, so a price change is visible immediately.",
        ],
      },
      {
        id: "purchase-follow-up",
        title: "Doing a Follow Up",
        audience: "PURCHASE_FMS",
        summary: "Chasing the vendor after a PO, and marking it done.",
        steps: [
          "Purchase page → Follow Up tab — POs whose follow-up deadline has arrived or is coming up show up here.",
          "Talk to the vendor, write a remark, and mark it 'Done'.",
        ],
        notes: [
          "This deadline is set automatically to one day before the PO's Lead Time — there's nothing to set by hand.",
        ],
      },
      {
        id: "purchase-material-received",
        title: "Recording Material Received",
        audience: "PURCHASE_FMS",
        summary: "Entering the quantity against the invoice when material arrives — this is where stock rises.",
        steps: [
          "Purchase page → Material Received tab.",
          "Attach the invoice on the line for the PO that arrived, and enter each item's quantity (full or partial, whatever actually arrived).",
          "Save — the stock In is written for you automatically, with no separate stock entry needed.",
        ],
        notes: [
          "A partial delivery leaves the PO 'Partially Received'; repeating this step once the rest arrives completes it.",
        ],
      },
    ],
  },

  {
    id: "leads",
    title: "Leads and Quotations (Sales Pipeline)",
    description:
      "From punching in or importing a lead through Qualify, Follow-up, Meeting, Negotiation and Quotation — the whole sales pipeline. It stops at 'Order Confirmed' once a quotation is accepted — the Order that follows (Payment/Credit review, Stock reservation, Dispatch commit) is its own 'Order' chapter.",
    sections: [
      {
        id: "leads-idea",
        title: "How Lead FMS works",
        audience: "LEAD_FMS",
        summary:
          "Every lead moves through a fixed pipeline — from New to either Order Confirmed (won) or Lost — and every step is recorded as an activity on that lead's own history.",
        how: [
          "Pipeline: New → Qualified (or Junk, ends here) → Follow-up (stays put on Call Back Later) → Meeting Scheduled (stays put on Reschedule) → Negotiation → Quotation Sent → Order Confirmed (won) / Lost (can happen from anywhere).",
          "Opening a lead's detail shows only the one action relevant to its current stage — e.g. just Qualify on a New lead, or Negotiation notes plus a Create Quotation button at Negotiation.",
          "Every action (Qualify, Follow-up, Meeting, Negotiation, Quotation, Won, Lost) immediately becomes a line in that lead's History — who did what, and when, all in one place.",
        ],
        notes: [
          "Lost can happen at any point from any non-finished stage — a reason is required.",
          "'Call Back Later' and 'Reschedule' are loops — the lead stays at that same stage, with a new follow-up/meeting date, until the Doer actually moves it forward.",
        ],
      },
      {
        id: "leads-punch",
        title: "Punching In or Importing a New Lead",
        audience: "LEAD_FMS",
        summary: "A lead's name alone is enough to get started — fill in whatever else you know.",
        steps: [
          "On the Leads page, click '+ New Lead' — only Name is required; Phone/Company/City/Product Interest are all optional.",
          "For bringing in many leads at once (e.g. from an exhibition or IndiaMART), use 'Bulk Upload' — download the template, fill it in Excel, and upload it.",
        ],
        notes: [
          "If a lead with the same name and phone already exists, a warning shows — but the lead is still created either way; a duplicate never blocks the save, only flags it.",
        ],
      },
      {
        id: "leads-pipeline",
        title: "What each pipeline stage means",
        audience: "LEAD_FMS",
        summary: "Which button to press when, and what it actually does.",
        how: [
          "New: a lead that just arrived. Qualify it as 'Qualified' (move it forward) or 'Junk' (not a real lead, ends here).",
          "Qualified/Follow-up: use 'Log Follow-up' to record Interested / Not Interested / Call Back Later — Call Back Later requires a next date/time, and the lead stays at this stage. 'Schedule Meeting' is also available from here.",
          "Meeting Scheduled: after the meeting, use 'Meeting Outcome' — Done (moves to Negotiation) / Reschedule (a new date) / Not Interested (Lost).",
          "Negotiation: save requirement notes (as many times as needed), then click 'Create Quotation' once ready.",
          "Quotation Sent: the quotation has gone out — once the customer replies, Accept or Reject it right from the Quotation page.",
          "Order Confirmed / Lost: both are final — nothing left to do, just a summary is shown.",
        ],
      },
      {
        id: "leads-quotation",
        title: "Building, Sending and Accepting a Quotation",
        audience: "LEAD_FMS",
        summary: "A header, an editable line-item grid (with a formula calculator), and GST/Freight totals — all on one page.",
        steps: [
          "From a lead's Negotiation stage, click 'Create Quotation' — party details, and the subject/note/terms, are pre-filled from Quotation Setup's own defaults.",
          "Fill in each line's Particular/Specification/Description/UOM. In the Qty box, type either a plain number or a formula (e.g. 2.5*3+1.2) and click away — the answer fills in on its own, with the formula itself remembered alongside it.",
          "Amount is computed automatically as soon as Rate is entered. Sub Total/GST/Payable at the bottom update the moment Freight or GST% changes.",
          "Use 'Save Draft' as many times as needed. Once ready, click 'Send' — at least one line is required before it can go out.",
          "Once the customer replies, click 'Mark Accepted' (the lead becomes 'Order Confirmed') or 'Mark Rejected'.",
          "'PDF Download' renders a professional quotation PDF at any time — the company/bank letterhead comes from Quotation Setup, and the logo from the Organization Logo.",
        ],
        notes: [
          "The Quotation Number (e.g. QN-0001) is allocated automatically in a series — the Admin sets the prefix/starting number in Quotation Setup.",
          "Once a quotation is Accepted it can no longer be edited — only the PDF can be downloaded again.",
          "Lead FMS's job ends right here — Order Confirmed only flips the lead's own status, and that same Accepted quotation lands in Order FMS's own Intake list (see the 'Order' chapter).",
        ],
      },
      {
        id: "leads-quotation-setup",
        title: "Quotation Setup",
        audience: "admin",
        summary: "Set the quotation PDF's letterhead and every new quotation's defaults once.",
        steps: [
          "Open Admin → Settings → the Quotation — Setup section.",
          "Fill in Company Name/Address/GSTIN and Bank Details — these print as the letterhead on every PDF.",
          "Write the Default Subject/Note/Terms & Conditions — these fill in automatically on a new quotation (and can still be changed per quotation afterwards).",
          "Set the Default GST%, how many days a Quotation stays Valid For, and the Number Prefix/Starting Number, then Save.",
        ],
        notes: [
          "The Organization Logo isn't set here — it comes from Settings' own Logo section, so there's no need to upload it twice.",
        ],
      },
    ],
  },

  {
    id: "orders",
    title: "Order (Sales chain, part two)",
    description:
      "After a Quotation is Accepted, or a Direct order altogether — through Payment/Credit review, Stock reservation, and Dispatch commit. Order FMS's own job ends here; the moment dispatch is committed, the order moves into PDI's own intake.",
    sections: [
      {
        id: "orders-idea",
        title: "How Order FMS works",
        audience: "ORDER_FMS",
        summary:
          "An order can start two ways — from a Lead (once its Quotation is Accepted) or Direct (straight from the Order page) — and both join the same pipeline afterwards.",
        how: [
          "Lead-sourced: an Accepted Quotation lands in the Order page's 'Intake' tab. Mapping every line to a real Item and confirming/creating the Customer Master row both happen in one 'Map' action.",
          "Direct: click '+ New Order', pick a Customer (existing or new), and fill in Items/Qty/Rate directly — no mapping needed, since real Items are chosen from the start.",
          "Both then follow the same path: Payment Review → (if needed) Credit Hold → Stock Check → Dispatch Pending → Ready For PDI. Cancel is available from any stage before Ready For PDI.",
          "Every action becomes a line in the order's own History — an order is read as a timeline, not a single status cell.",
        ],
      },
      {
        id: "orders-payment-review",
        title: "Payment Review — advance or credit check",
        audience: "ORDER_FMS",
        summary: "Clicking 'Run Payment Review' checks the customer's credit/advance position.",
        how: [
          "If the customer has no credit extended (Credit Limit and Credit Days are both blank in Customer Master), at least one advance payment must be recorded before it can proceed — 'Record Payment' works at any stage, for any amount.",
          "If the customer has credit, two things are checked together: (a) would this order push their combined outstanding across all their open orders over the Credit Limit, and (b) does any of their past orders remain unpaid past its own Credit Days. Either being true sends the order to 'Credit Hold'.",
          "If both check out, the order goes straight to 'Stock Check'.",
        ],
        notes: [
          "Outstanding is always worked out fresh — order value minus whatever's been recorded as paid on it, summed across every open (non-Cancelled) order. Nothing is stored as a running total.",
        ],
      },
      {
        id: "orders-credit-hold",
        title: "Clearing a Credit Hold",
        audience: "ORDER_FMS",
        summary: "A Credit Hold is a human decision — the system never clears its own hold.",
        how: [
          "Only the 'Credit-Hold Approver' chosen in Admin → Settings → Order — Setup (or an Admin) can click 'Approve' on an order's detail to clear its Credit Hold.",
          "Clearing it moves the order to 'Stock Check', and who approved it, and when, is recorded in History.",
        ],
      },
      {
        id: "orders-stock-check",
        title: "Stock Check — reserving FG stock, and shortages",
        audience: "ORDER_FMS",
        summary: "Clicking 'Run Stock Check' on an order's detail reserves whatever Free stock is available for it, immediately.",
        how: [
          "For every line, whatever Free FG stock is available at that moment is reserved — the full quantity, or as much as there is. Whatever's left over becomes a 'shortage'.",
          "Once reserved, that stock no longer shows as Free for anyone else — the Inventory page's own Free figure drops by the same amount, exactly like a production plan's own reserved raw material.",
          "A reservation writes nothing to the stock ledger — nothing has shipped yet, this only marks that stock as set aside for this order.",
          "Once every line is processed the order moves to 'Dispatch Pending' — whether or not there was a shortage (a short item can still arrive later from production).",
        ],
        notes: [
          "Any shortage immediately creates a Task and sends a WhatsApp message to every user holding PPC_PLAN access, as a reminder to plan production. This is best-effort — a failed WhatsApp send (no phone on file, ChatXFlow not configured) never affects the stock reservation itself.",
        ],
      },
      {
        id: "orders-dispatch",
        title: "Dispatch Commit Date and Ready For PDI",
        audience: "ORDER_FMS",
        summary: "A Dispatch Pending order just needs a commit date.",
        steps: [
          "On the order's detail, at the Dispatch Pending stage, pick a Date and click 'Commit'.",
          "The order becomes 'Ready For PDI' — Order FMS's own job ends right here; from here it shows up in PDI's (Pre-Dispatch Inspection) own intake queue.",
        ],
      },
      {
        id: "orders-cancel",
        title: "Cancelling an Order",
        audience: "ORDER_FMS",
        summary: "An order can be cancelled from any stage before Ready For PDI.",
        steps: [
          "On the order's detail, click 'Cancel Order', type a reason (optional), and confirm.",
        ],
        notes: [
          "Cancelling immediately releases any FG stock this order had reserved — it becomes Free again for other orders/plans.",
        ],
      },
      {
        id: "orders-setup",
        title: "Order — Setup",
        audience: "admin",
        summary: "Set each step's Doer/TAT (informational) and the Credit-Hold Approver (the one that's actually enforced) once.",
        steps: [
          "Open Admin → Settings → the Order — Setup section.",
          "Fill in a Doer and TAT for each of Items Mapping/Payment Review/Stock Check/Dispatch Commit.",
          "Pick the one user who may clear a Credit Hold in 'Credit-Hold Approver' — this is a separate, specific permission, not any step's own Doer.",
        ],
        notes: [
          "Doer/TAT are informational/planning fields only — any user with ORDER_FMS access can work any order's any step, same as Purchase FMS. Only the Credit-Hold Approver is actually locked down — only that user (or an Admin) may clear a Credit Hold.",
        ],
      },
    ],
  },

  {
    id: "pdi",
    title: "PDI (Pre-Dispatch Inspection) — Sales chain, part three",
    description:
      "Inspecting an order's goods before dispatch. An order lands here in Intake the moment it becomes 'Ready For PDI'; once PDI passes, the order moves forward independently into both TMS (Transport) and Accounts (Invoice). Dispatch itself (actually sending the truck off) hasn't been built as its own module yet.",
    sections: [
      {
        id: "pdi-idea",
        title: "Waiting for Stock vs. Ready to Inspect",
        audience: "PDI_FMS",
        summary:
          "Once an order goes 'Ready For PDI' in Order FMS, it becomes a candidate on PDI's own Intake tab — punching it in creates a new PDI inspection, which starts out Pending.",
        how: [
          "'Waiting for Stock' and 'Ready to Inspect' are never stored anywhere — they're worked out fresh every time from the order's own items: if any line still has a shortage greater than 0, it's 'Waiting for Stock'; otherwise it's 'Ready to Inspect'.",
          "While an order is 'Waiting for Stock', the Inspect action (Pass/Fail) isn't offered at all — goods that haven't actually arrived yet can't be inspected.",
          "The moment new FG stock arrives — from production, a manual stock-in, or a bulk import, it doesn't matter which — Order FMS automatically tries to clear this order's remaining shortage on its own; there is no manual 'recheck' button anywhere. Once the shortage clears, the PDI board shows 'Ready to Inspect' the next time it's opened.",
        ],
        notes: [
          "If two orders are both waiting on the same SKU and the stock that arrives isn't enough to clear both, the order that was created first is fully satisfied before whatever's left goes to the newer order.",
        ],
      },
      {
        id: "pdi-inspect",
        title: "Recording a Pass or Fail",
        audience: "PDI_FMS",
        summary: "Once an order is 'Ready to Inspect', its detail lets you record Pass or Fail — a remark and a report attachment are both optional.",
        steps: [
          "Click the inspection on the PDI board and look over the order's items (qty/reserved/short).",
          "Optionally write a remark and/or attach a report, then click 'Pass' or 'Fail'.",
        ],
        notes: [
          "Passing sets the inspection to 'Passed', and who passed it and when is recorded in History.",
          "Failing leaves the inspection right where it was — 'Pending'. No new inspection is created; the same one stays open for another Pass/Fail attempt. Writing the reason for the fail as a remark helps whoever re-inspects it know exactly what to check.",
        ],
      },
    ],
  },

  {
    id: "tms",
    title: "TMS (Transport) — Sales chain, part four",
    description:
      "An order lands here once PDI passes — arranging the vehicle/truck and recording its Loading Dock confirmation. Every order runs one of two ways, 'Self' (we arrange it ourselves, Freight Paid) or 'Party' (the customer arranges their own pickup, To Pay) — decided right when the Order itself is created.",
    sections: [
      {
        id: "tms-idea",
        title: "Self vs. Party, and what 'Fully Shipped' means",
        audience: "TMS_FMS",
        summary:
          "Every new Order now states, on its own Order Form, who arranges its transport — Self or Party. That's what decides what happens to it in TMS.",
        how: [
          "Self (Freight Paid): we ourselves pick a Transport Vendor, vehicle size and freight price to plan a shipment.",
          "Party (To Pay): the customer is sending their own vehicle — all we do is expect it, Follow Up if it's late, and confirm the Loading Dock once it shows up. Vendor/vehicle price don't even apply here.",
          "An order is 'Fully Shipped' once every one of its lines' full quantity has been allocated across one or more shipments — this is never stored, it's worked out fresh every time by adding it up. One order can need more than one shipment (e.g. two trucks).",
        ],
        notes: [
          "If an order predates this column (so Self/Party was never set), TMS's own Intake shows it as 'Decision Needed' — the transport arrangement has to be set before any shipment can be planned for it.",
        ],
      },
      {
        id: "tms-plan",
        title: "Planning a shipment and confirming the Loading Dock",
        audience: "TMS_FMS",
        summary: "Open a candidate order to plan a shipment, then confirm the Loading Dock once the truck actually arrives.",
        steps: [
          "Click an order on the TMS board's 'Candidates' tab.",
          "For Self, fill in the Transport Vendor, Vehicle Size and Freight Price; for Party, go straight ahead.",
          "Fill in From Warehouse/To Address (To Address is pre-filled from the order's own shipping address, editable if needed), and give the quantity of each line riding on this shipment — every line defaults to its full remaining quantity, which can be reduced if only part of it is going out.",
          "Click 'Plan Shipment' and the shipment is created in 'Pending' status.",
          "Once the truck actually shows up, click 'Confirm Loading Dock' on that shipment — the Vehicle No./Driver Contact No. can also be entered here if they weren't given earlier.",
        ],
        notes: [
          "'Follow Up' on a Party-arranged shipment is a plain reminder — no field changes, just a note logged in History that the truck hasn't shown up yet.",
          "Planning several shipments against one order is completely normal — e.g. a large order going out on two trucks means planning the shipment twice, giving each truck its own lines/quantities.",
        ],
      },
      {
        id: "tms-vendors",
        title: "Transport Vendor Master",
        audience: "TMS_FMS",
        summary: "Transport Vendors have their own small master — separate from Purchase Vendor, inside TMS's own board under its 'Vendors' tab.",
        steps: [
          "On the TMS board's 'Vendors' tab, add vendors one at a time with '+ Add Transport Vendor', or use 'Bulk Upload' to download a template and add several at once from Excel/CSV.",
        ],
      },
    ],
  },

  {
    id: "accounts",
    title: "Accounts — Invoice (Receivables)",
    description:
      "Creating and issuing an order's Invoice — with an Invoice No., E-way Bill and supporting documents. This is only the first, small piece of a future full Accounts module — bigger things like a GL or aging reports haven't been built yet.",
    sections: [
      {
        id: "accounts-idea",
        title: "One Order, One Invoice",
        audience: "ACCOUNTS_FMS",
        summary: "Once PDI passes, an order lands in Accounts' own 'Needs Invoicing' tab, until its Invoice is created.",
        how: [
          "Each order can only ever have one Invoice — trying to create a second one is blocked.",
          "When creating an Invoice, 'Final Value' is suggested automatically: the Order Value, plus — only when transport was arranged 'Self' — that order's own shipments' freight added in. Party-arranged freight never gets added, since that's the customer's own cost.",
          "This suggested value is only a suggestion — it can be adjusted before saving.",
        ],
      },
      {
        id: "accounts-issue",
        title: "Creating a Draft and Issuing it",
        audience: "ACCOUNTS_FMS",
        summary: "An invoice starts life as a Draft — Issue it once the real document/number is ready.",
        steps: [
          "From 'Needs Invoicing', click an order and 'Create Invoice' — check/adjust the Final Value and save. Everything else (Invoice No., documents, E-way Bill) stays optional at Draft.",
          "Once the Invoice No. is known and the Invoice Document is ready, open the Draft, fill them in, then click 'Issue'.",
        ],
        notes: [
          "Both the Invoice No. and the Invoice Document are required to Issue — the E-way Bill always stays optional (not every dispatch needs one).",
          "Once issued, an Invoice can no longer be edited — it's a real business document, so it doesn't change once it exists.",
          "An invoice's own detail shows both 'Invoiced' and 'Received' — 'Received' is read straight from Order FMS's own payments; Accounts doesn't keep a second payments record of its own.",
        ],
      },
    ],
  },

  {
    id: "dispatch",
    title: "Dispatch — Sales chain, part five (the last one)",
    description:
      "Once a shipment is confirmed at the Loading Dock in TMS (and the order's own Invoice has been Issued), it lands here — issuing a Gate Pass and actually dispatching the real stock, then Mark Dispatched to close the shipment out. This is the final step of the whole Sales chain (Lead → Order → PDI → TMS → Dispatch).",
    sections: [
      {
        id: "dispatch-idea",
        title: "Gate Pass and the real stock dispatch",
        audience: "DISPATCH_FMS",
        summary:
          "Dispatch board's 'Candidates' tab lists every shipment confirmed at the Loading Dock but not yet dispatched — until the order's Invoice is Issued, a candidate shows 'Waiting on Invoice'.",
        how: [
          "Clicking a candidate opens 'Confirm Dispatch' — a sequential Gate Pass number (e.g. GP-0001) is generated automatically.",
          "This is also where the real stock actually leaves — whatever item/quantity is on the shipment gets a real 'Out' entry written to the Stock Ledger. This is never best-effort: if stock is genuinely short for some reason, the whole Confirm Dispatch fails and nothing is left half-saved.",
          "At the same time, an Assignee (who will track this shipment) and a TAT (Value + Unit — Minutes/Hours/Days) are given — the deadline is worked out from that assignee's own working-hours calendar, exactly the way FMS steps do it. This TAT isn't a fixed org-wide setting like Purchase/Order Setup's — it's given fresh, right here, for each shipment.",
          "A Gate Pass attachment (e.g. a scanned copy) is optional.",
        ],
        notes: [
          "One order can have several shipments (e.g. two trucks) — each shipment gets its own Gate Pass and its own separate Confirm/Mark-Dispatched lifecycle.",
        ],
      },
      {
        id: "dispatch-mark",
        title: "Mark Dispatched — closing a shipment out",
        audience: "DISPATCH_FMS",
        summary:
          "Once the truck has actually left, move that shipment from 'In Transit' to 'Dispatched' — either the assigned user themselves, or anyone with Dispatch access, can do this.",
        steps: [
          "Click the shipment on the 'In Transit' tab.",
          "Optionally attach 'Proof of Dispatch' (e.g. a signed LR or the transporter's own confirmation slip) — this isn't proof the goods reached the customer, only that the truck actually left.",
          "Click 'Mark Dispatched'.",
        ],
        notes: [
          "Once every one of an order's shipments is 'Dispatched', that order shows 'Order Fully Dispatched' — this is genuinely the final stop of the whole Sales chain (from Lead all the way to Dispatch). No module picks up from here.",
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
          "Saving a new product's BOM also creates its Item automatically in Inventory → Finished Goods (Category FG, unit PCS) if one doesn't already exist — so recording FG stock once production completes never gets blocked. Planning figures like Lead Time and Max Level are still left blank; fill those in from the item itself whenever you're ready.",
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
          "Optionally fill in an Order No (e.g. a customer's PO number) and a Production Line.",
          "Press Check material to see what is short, product by product.",
          "Press Create plan.",
        ],
        notes: [
          "'Check material' only shows; it writes nothing. It runs exactly the same calculation that creating the plan will run, so what you see is what you get.",
          "Only products with an active BOM can be planned.",
          "Each product becomes its own plan, because production starts and finishes per product. The material, though, is shared out across all of them at once.",
          "Every plan gets a Job No automatically (for paperwork) — Order No is typed by hand, matched against nothing, and exists purely as a record.",
          "Choosing a Production Line is optional — it's the FMS Template that runs this product's multi-step process (say, Winding through to Dispatch). Whichever Line is chosen, pressing Start Production runs only that one Line for this plan; no other Line touches it.",
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
        id: "users",
        title: "Creating users and granting access",
        audience: "admin",
        summary:
          "When creating a person, decide which parts of the system they will work in.",
        steps: [
          "Admin → Users → Add User.",
          "Enter the name, email, password, role, department and WhatsApp number.",
          "Choose a Reporting Manager — this is what the Leave System's 'Reporting Manager' approval step resolves against for this user.",
          "Tick the modules that person needs under System Access.",
          "Create the user, and send them the password.",
        ],
        notes: [
          "Role and access are two different things. The role says whether somebody is an Admin; access says which module they work in. Letting somebody assign tasks no longer means making them an Admin — it is just a checkbox.",
          "An Admin holds access to every module automatically.",
          "The modules you tick are the ones that appear as tabs on that person's dashboard.",
          "If a password is forgotten, set a new one from Manage → Reset Password. The old one can never be read back.",
          "The WhatsApp number should start with the country code (91), or just enter a 10-digit Indian mobile number — the system prepends 91 automatically if it's missing. Without this, WhatsApp messages never arrive.",
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
        id: "holidays",
        title: "Building the Holiday List",
        audience: "admin",
        summary:
          "No Recurring Task, FMS or IQC deadline counts against these dates — on top of the weekly-off (Sunday, set in FMS Shifts), these are the extra non-working days.",
        steps: [
          "Open Admin → Settings → Holiday List.",
          "To add one at a time, fill in the date and an optional name, then press Add.",
          "To add many at once, use Import at the top — download the template, fill it in, and upload it.",
          "A holiday's name can be edited straight in the table and saved, or removed entirely with 'Remove'.",
        ],
        notes: [
          "Adding the same date twice updates the existing row rather than creating a duplicate.",
          "Skipping Sunday is not something you set here — it comes automatically from FMS Shifts' weekly-off. The Holiday List is only for the extra dates on top of that (like Diwali or another specific day off).",
        ],
      },
      {
        id: "troubleshooting",
        title: "When something does not work",
        audience: "admin",
        summary: "Common problems and the first thing to try.",
        notes: [
          "Somebody cannot sign in — do not have them copy the password from anywhere (only its encrypted hash is ever stored). Give them a new one with Reset Password.",
          "Somebody sees no tabs at all — nothing is ticked under their System Access.",
          "WhatsApp is not sending — check with Send Test Message under Settings, then check the ChatXFlow session.",
        ],
      },
    ],
  },

  {
    id: "leave",
    title: "Leave System (Buddy System)",
    description:
      "From filing a leave request to work moving to a buddy's name and back — the system's leave arrangement end to end.",
    sections: [
      {
        id: "leave-idea",
        title: "How the buddy system works",
        audience: "everyone",
        summary:
          "When a Doer goes on leave, it needs approval from their Reporting Manager (or whoever the Admin has set up). The moment it's fully approved, that Doer's pending work moves — automatically — to a Buddy they chose themselves, for however many days the leave lasts, then moves back once it ends.",
        how: [
          "The Doer picks their own Buddy while filing the leave — nobody else can choose it, because the Doer is the one who knows who can actually pick up their work.",
          "Approval can be a single step or several, however the Admin has built the chain in Settings (say: Reporting Manager first, then HR). Each org decides this chain to fit its own needs.",
          "Reassignment only happens once a leave is fully Approved. While any step is still Pending, the work stays with the Doer.",
          "The moment the leave starts (or immediately, if it starts today), every Task and FMS step still Pending for the Doer moves to the Buddy's name. The moment it ends, whatever is still Pending and still held by the Buddy moves back to the Doer — nothing else.",
          "Anything the Buddy actually finished during the leave stays finished — it does not move back, since it already happened under the Buddy's name.",
        ],
        notes: [
          "V1 does not track a leave balance or quota — only approval and reassignment. How many days of leave remain is not tracked yet.",
          "The Doer's work sits alongside the Buddy's own work — both show up in the same place (the Tasks/FMS page), nothing separate to go hunting for.",
        ],
      },
      {
        id: "leave-apply",
        title: "Applying for your own leave",
        audience: "everyone",
        summary: "File your leave from the Leave page.",
        steps: [
          "Leave page → press 'Apply for Leave'.",
          "Choose the Leave Type (Casual/Sick/Earned/Other), and set the Start and End Date.",
          "Choose a Buddy — any active user other than yourself.",
          "Write a reason and press Apply.",
        ],
        notes: [
          "If the approval chain is empty (the Admin hasn't set one up), the leave is Approved instantly — nothing to wait on.",
          "A leave that is still Pending or Approved can be cancelled — cancelling immediately reverts any reassignment that had already happened.",
        ],
      },
      {
        id: "leave-approve",
        title: "Approving or rejecting someone's leave",
        audience: "everyone",
        summary:
          "If you're a step in someone's approval chain, their request shows up for you under the 'Approvals' tab.",
        steps: [
          "Open the Leave page's Approvals tab.",
          "Read the reason for the request you need to decide on, and add a remark if you want.",
          "Press Approve or Reject.",
        ],
        notes: [
          "In a multi-step chain, approving one step reveals it to the next approver — the leave only becomes 'Approved' once every step has approved it.",
          "Rejecting at any single step rejects the whole leave immediately; no further step runs.",
        ],
      },
      {
        id: "leave-emergency",
        title: "Emergency Leave — filed by HR",
        audience: "LEAVE_HR",
        summary:
          "When a Doer genuinely cannot file their own leave (a sudden emergency), HR can file it on their behalf — choosing both the Doer and the Buddy themselves.",
        steps: [
          "Leave page → press 'File Emergency Leave'.",
          "Choose the Doer this is being filed for.",
          "Fill in the Leave Type, Buddy, Start/End Date and Reason.",
          "Press File.",
        ],
        notes: [
          "Everything after filing — approval and reassignment — runs exactly like a normal leave; only who filed it is different.",
        ],
      },
      {
        id: "leave-approval-setup",
        title: "Setting up the approval chain",
        audience: "admin",
        summary:
          "Admin → Settings → Leave Approval Setup decides who needs to approve a leave, and in what order, before it takes effect.",
        steps: [
          "Open Admin → Settings → Leave — Approval Setup.",
          "Press 'Add a step' to add one.",
          "For each step choose either 'Reporting Manager' (each Doer's own Reporting Manager, as set on their User profile) or 'Specific person' (always the same fixed user, e.g. HR or MD).",
          "Reorder steps with the up/down arrows, then save.",
        ],
        notes: [
          "An empty chain means every leave is Approved instantly — nothing is waited on.",
          "A 'Reporting Manager' step only works once that Doer's own profile has a Reporting Manager set (when creating or editing the user) — if not, that step is simply skipped for them.",
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
          "They go to /signup and enter the organization's name, their own admin account, and optionally a logo.",
          "The system registers the organization, makes them an Admin and signs them in — nothing else to connect.",
        ],
        notes: [
          "One email can exist only once across the whole platform — sign-in asks only for an email, so it has to be unique.",
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
          "Nothing is deleted — not the data, not the users. Switching it back on returns everything to how it was.",
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
          "If two people edit the very same record at exactly the same moment, one of the changes can be lost. Different people doing their own work is not a problem.",
          "File uploads now go straight from the browser to storage, so large videos and photos work too.",
          "The automated jobs run once a day.",
        ],
      },
    ],
  },

  {
    id: "fms",
    title: "FMS — multi-step processes",
    description: "Work with more than one step, where each step has its own deadline and its own person.",
    sections: [
      {
        id: "fms-idea",
        title: "How FMS works",
        audience: "everyone",
        summary:
          "An FMS is started from a template made of several steps — each step is assigned to a user and has its own turnaround time (TAT).",
        how: [
          "The moment a step is assigned to you, its deadline starts. The deadline only counts the company's actual working hours — night, lunch, tea break, weekly-offs and holidays are never counted.",
          "Finished within the deadline: \"On Time\". Finished after it: \"Delay Done\". Still pending after the deadline has passed: shown as \"Not Done\" — this is never stored either, it's worked out live every time, the same way an MIS score is.",
          "If you already have another step open when a new one is assigned to you, the new step's deadline starts only after your existing one's deadline arrives — you can only hold one open clock at a time.",
        ],
        notes: [
          "A step's outcome (e.g. Pass/Fail) decides which step runs next — the next step isn't the same for everyone.",
        ],
      },
      {
        id: "fms-complete",
        title: "Completing your step",
        audience: "everyone",
        summary: "See and complete your pending steps on the FMS page.",
        steps: [
          "Open the FMS page — every step assigned to you shows up here.",
          "Press Complete on whichever step you've finished.",
          "Choose an outcome (e.g. Pass or Fail) and add a remark if you'd like.",
        ],
      },
      {
        id: "fms-dashboard-history",
        title: "Steps, MIS score, and History on the Dashboard",
        audience: "everyone",
        summary:
          "Your pending FMS steps now show up on the Dashboard too, not just the FMS page — and their TAT counts toward your MIS score as well.",
        how: [
          "The moment a step is assigned to you (say, a Production Line's step 1, as soon as a plan starts), it shows up right away on your Dashboard, inside the \"FMS Steps\" card on the Overview tab.",
          "Even after you complete it, that step keeps showing on the Dashboard until the end of that working day — it doesn't vanish the instant it's done. The next day it moves into History.",
          "Every step's outcome (On Time / Delay Done / Not Done) counts toward the same single MIS score you already have — Tasks and FMS together, not two separate scores.",
        ],
        notes: [
          "How your MIS score was built shows line by line in the Dashboard's \"Your score\" tab — Task and FMS rows in one table, with an \"(FMS)\" tag on the FMS ones.",
          "The FMS page's \"History\" tab shows every completed step with its Doer, Job No, Order No and Product — who did what, and when, all in one place. You only see your own history unless you have Team Performance access.",
        ],
      },
      {
        id: "fms-shifts",
        title: "Setting Company Running Time",
        audience: "FMS_ADMIN",
        summary:
          "Set shift hours, lunch, tea (optional) and weekly-off in Settings — this is what every step's deadline is worked out from.",
        how: [
          "Each user has their own shift (set when creating or editing a user). Setting a shift's start/end, lunch and tea break (if any) is what makes that shift's people's TAT count correctly.",
          "A weekly-off (Sunday by default) pushes every new step's deadline past that day. To open a specific date back up — say, running production on one particular Sunday — add a Week-off Override in Settings: for everyone, for one Department, or for one user.",
        ],
        notes: [
          "Changing shift/lunch/tea/weekly-off only affects steps created afterwards — a step already in progress keeps its existing deadline.",
        ],
      },
      {
        id: "fms-template",
        title: "Building a new FMS Template",
        audience: "FMS_ADMIN",
        summary: "Define a multi-step process once — it can then run as many times as needed.",
        steps: [
          "On the Templates tab of the FMS page, press \"New FMS Template\".",
          "For each step, fill in its name, who it's assigned to, and its TAT (in Minutes, Hours, or Days).",
          "Choose the step's Outcome Type — Done, Pass and Fail, Pass/Fail/Scrap Qty, Number, Text, Attachment, or Custom (type your own outcomes). Then choose which step runs next for each outcome, or that the FMS ends there.",
          "Press Create Template.",
        ],
        notes: [
          "Leaving the trigger as \"MANUAL\" means the FMS only starts by hand. Giving it a module's event key instead (e.g. INWARD_ENTRY_CREATED), or another FMS template's outcome key, starts it automatically when that happens — avoiding a trigger loop is on whoever builds the template.",
          "Archiving a template doesn't affect its steps already in progress — only new instances stop being created from it. An Archived template that no step is currently running can also be permanently deleted from the Templates list.",
          "A \"Pass/Fail/Scrap Qty\" step carries its quantity forward automatically: split 100 into 98 Pass and 2 Fail, and 98 moves on to the next step while the 2 become a new pending task for the same doer, on the same step — they can split it again (Pass/Fail/Scrap, looping until it resolves) or write it off with Scrap Qty. The final step's stock write only ever reflects whatever quantity actually made it all the way through.",
          "Any step's deadline can be sourced from an earlier step's own field instead of a fixed TAT number — tick \"Take the deadline from an earlier step's field\", pick that step and field, and give an offset (+/-). For example in a Purchase FMS: step 1 captures \"Lead Days\" (say, 10), step 2 \"Follow Up\" uses offset -1 (a 9-day deadline), step 3 \"Material Received\" uses offset 0 (a 10-day deadline) — one number driving both deadlines.",
          "Giving a template the trigger \"INDENT_APPROVED\" starts it the moment an indent is approved — this is how a Purchase FMS gets built: Vendor Details, Per Item Price, and a PO Attachment are just Form fields (an Attachment-type field for the PO), and Lead Days is a Number field.",
        ],
      },
    ],
  },
];
