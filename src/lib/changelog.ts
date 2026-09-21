/**
 * The in-app "what's new" changelog, as data — edited by hand each time a user-facing
 * feature ships, the same way `src/lib/guide.ts` is data rather than a page of prose.
 *
 * Newest entry first. `ChangelogMenu` (`src/components/changelog-menu.tsx`) treats
 * `CHANGELOG[0].id` as "the latest thing a viewer could have seen" and compares it against
 * a plain `localStorage` marker — there is no per-user "last seen" column, on purpose (see
 * CLAUDE.md: schema changes are reviewed by the session driver, not added in passing for a
 * nice-to-have banner). Only genuinely user-visible changes belong here — an internal
 * refactor a user never saw (removing a cache, renaming a helper) has no entry.
 */
export interface ChangelogEntry {
  /** Stable and sortable-by-date; never reuse or edit an id once shipped, or a viewer who
   *  has already seen it will have it resurface as "new". */
  id: string;
  date: string;
  module: string;
  title: string;
  description: string;
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: "2026-09-21-inward-vendor-lookup",
    date: "2026-09-21",
    module: "Inward",
    title: "Inward ab Vendor Master se juda hai",
    description:
      "Inward entry ka Party Name ab free text nahi — Vendor Master se chuna jaata hai, jaisa Purchase FMS me pehle se hota hai.",
  },
  {
    id: "2026-09-21-ppc-line-no-broadcast",
    date: "2026-09-21",
    module: "PPC",
    title: "Production plan ab sirf apni chuni hui Line start karta hai",
    description:
      "Start Production dabate hi sirf plan ki apni Line chalti hai — pehle jaisa har Active Line ko ek saath try karna band ho gaya.",
  },
  {
    id: "2026-09-21-bom-auto-item",
    date: "2026-09-21",
    module: "BOM",
    title: "BOM save karte hi uska product Items master me ban jaata hai",
    description:
      "Kisi product ki pehli BOM save hote hi uska Item apne aap ban jaata hai — ab production ke waqt 'SKU nahi mila' wali error nahi aayegi.",
  },
  {
    id: "2026-09-21-holiday-list-crud",
    date: "2026-09-21",
    module: "Admin",
    title: "Holiday List ab Admin khud manage kar sakta hai",
    description:
      "Settings me ab Holiday List add, edit, delete aur bulk import (Excel/CSV) se seedha manage hoti hai.",
  },
  {
    id: "2026-09-20-whatsapp-phone-fix",
    date: "2026-09-20",
    module: "WhatsApp",
    title: "WhatsApp message ab sahi number par jaata hai",
    description:
      "Bina '91' wale 10-digit number par bhi Task aur FMS ke WhatsApp message ab sahi se pahunchte hain.",
  },
  {
    id: "2026-09-20-purchase-fms",
    date: "2026-09-20",
    module: "Purchase",
    title: "Purchase FMS shuru se aakhir tak",
    description:
      "Indent Approve se PO Issue, Follow Up aur Material Received tak — poora Purchase flow ab system me hai.",
  },
  {
    id: "2026-09-20-fg-split",
    date: "2026-09-20",
    module: "Inventory",
    title: "Finished Goods ka apna alag page",
    description:
      "Finished Goods ab Inventory se alag apne page par dikhta hai, taaki raw material ke saath mix na ho.",
  },
  {
    id: "2026-09-20-leave-system",
    date: "2026-09-20",
    module: "Leave",
    title: "Leave (buddy system) jud gaya",
    description:
      "Ab leave apply, approval chain se paas, aur chhutti ke dauraan tasks/FMS steps ka buddy ko automatic reassignment — sab ek jagah.",
  },
  {
    id: "2026-09-19-nav-groups",
    date: "2026-09-19",
    module: "Nav",
    title: "Upar ka nav bar groups me bant gaya",
    description:
      "Menu ab MDO, PMS, Stock, FMS aur Others groups me bant gaya hai, taaki roz ke kaam aur setup wale link mix na hon.",
  },
];
