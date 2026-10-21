import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { items, vendors, customers, orders, users } from "@/db/schema";
import { getTenantOrgId } from "@/lib/tenant";
import { getSetting, upsertSetting } from "@/lib/settings";

/**
 * First-run onboarding checklist (roadmap Phase 3 item #11, pulled forward 2026-10-21).
 * A fresh org's dashboard is otherwise blank with no guided "what do I do first" path.
 * Admin-only (the person most likely to be mid-setup); dismissible permanently via the
 * existing per-org `settings` key-value table — no new migration needed.
 *
 * Each step is a cheap EXISTS-style check (`limit(1)`), not a full list fetch — this runs
 * on every Admin's dashboard render until dismissed, so it must stay index-backed and
 * small, not re-read every item/order a growing org has accumulated.
 */
export type OnboardingStep = {
  key: "item" | "party" | "order" | "team";
  label: string;
  description: string;
  href: string;
  done: boolean;
};

export type OnboardingStatus = {
  dismissed: boolean;
  steps: OnboardingStep[];
  allDone: boolean;
};

const DISMISSED_KEY = "ONBOARDING_DISMISSED";

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const orgId = await getTenantOrgId();

  const [dismissedValue, itemRow, partyRow, orderRow, extraUserRow] = await Promise.all([
    getSetting(DISMISSED_KEY),
    db.select({ id: items.sku }).from(items).where(eq(items.orgId, orgId)).limit(1),
    // Either a Vendor or a Customer counts as "added a party" — the checklist step is
    // about the Parties module in general, not specifically one sub-type.
    Promise.all([
      db.select({ id: vendors.id }).from(vendors).where(eq(vendors.orgId, orgId)).limit(1),
      db.select({ id: customers.id }).from(customers).where(eq(customers.orgId, orgId)).limit(1),
    ]),
    db.select({ id: orders.id }).from(orders).where(eq(orders.orgId, orgId)).limit(1),
    // "Invited your team" = at least one more user exists beyond whoever signed up —
    // cheapest proxy available without tracking signup-time user count separately.
    db.select({ id: users.id }).from(users).where(eq(users.orgId, orgId)).limit(2),
  ]);

  const [vendorRow, customerRow] = partyRow;

  const steps: OnboardingStep[] = [
    {
      key: "item",
      label: "Apna pehla Item add karein",
      description: "Inventory me kya stock karna hai — raw material, consumable ya finished good.",
      href: "/inventory",
      done: itemRow.length > 0,
    },
    {
      key: "party",
      label: "Vendor ya Customer add karein",
      description: "Jin se aap khareedte/bechte hain unka record banayein.",
      href: "/parties",
      done: vendorRow.length > 0 || customerRow.length > 0,
    },
    {
      key: "order",
      label: "Pehla Order banayein",
      description: "Ek customer order punch karein aur pipeline dekhein.",
      href: "/orders",
      done: orderRow.length > 0,
    },
    {
      key: "team",
      label: "Apni team invite karein",
      description: "Doosre users add karein taaki kaam baant sakein.",
      href: "/admin/users",
      done: extraUserRow.length > 1,
    },
  ];

  return {
    dismissed: dismissedValue === "true",
    steps,
    allDone: steps.every((s) => s.done),
  };
}

export async function dismissOnboarding(): Promise<void> {
  await upsertSetting(DISMISSED_KEY, "true");
}
