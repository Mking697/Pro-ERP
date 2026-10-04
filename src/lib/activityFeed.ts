import { desc, eq } from "drizzle-orm";
import {
  leadActivities,
  orderActivities,
  pdiActivities,
  tmsActivities,
  dispatchActivities,
} from "@/db/schema";
import { db } from "@/db/client";
import { getTenantOrgId } from "@/lib/tenant";
import { getUserById } from "@/lib/auth/users";

/**
 * One cross-module timeline entry for the Dashboard's "Recent Activity" card.
 *
 * Every pipeline leg (Lead, Order, PDI, TMS, Dispatch) already writes its own
 * append-only `*_activities` table — this is not a new source of truth, just a merged,
 * time-sorted read across the ones the viewer is entitled to see. A module with no
 * activity table of its own (Inward/IQC, Inventory, FMS steps in general) has no entry
 * here yet; it would need its own `*_activities` table first, the same way these five do.
 */
export interface ActivityEntry {
  id: string;
  module: "leads" | "orders" | "pdi" | "tms" | "dispatch";
  moduleLabel: string;
  message: string;
  actorId: string;
  actorName: string;
  createdAt: string;
  /** Which report/module page this entry's module links back to. */
  href: string;
}

const PER_MODULE_LIMIT = 8;

/** A read that must never take the whole feed down — one broken table/query should drop
 * only its own slice, same `safe()` pattern as analytics.tsx and attention-strip.tsx. */
async function safe<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch {
    return [];
  }
}

/**
 * The merged, newest-first activity feed for whatever modules this viewer holds a grant
 * for. Capped at `limit` total entries — a home-page widget, not a full audit log (each
 * module's own detail page already has its complete timeline via listLeadActivities() etc).
 */
export async function listRecentActivity(
  access: readonly string[],
  limit = 12
): Promise<ActivityEntry[]> {
  const orgId = await getTenantOrgId();

  const [leadRows, orderRows, pdiRows, tmsRows, dispatchRows] = await Promise.all([
    access.includes("LEAD_FMS")
      ? safe(() =>
          db
            .select()
            .from(leadActivities)
            .where(eq(leadActivities.orgId, orgId))
            .orderBy(desc(leadActivities.createdAt))
            .limit(PER_MODULE_LIMIT)
        )
      : Promise.resolve([]),
    access.includes("ORDER_FMS")
      ? safe(() =>
          db
            .select()
            .from(orderActivities)
            .where(eq(orderActivities.orgId, orgId))
            .orderBy(desc(orderActivities.createdAt))
            .limit(PER_MODULE_LIMIT)
        )
      : Promise.resolve([]),
    access.includes("PDI_FMS")
      ? safe(() =>
          db
            .select()
            .from(pdiActivities)
            .where(eq(pdiActivities.orgId, orgId))
            .orderBy(desc(pdiActivities.createdAt))
            .limit(PER_MODULE_LIMIT)
        )
      : Promise.resolve([]),
    access.includes("TMS_FMS")
      ? safe(() =>
          db
            .select()
            .from(tmsActivities)
            .where(eq(tmsActivities.orgId, orgId))
            .orderBy(desc(tmsActivities.createdAt))
            .limit(PER_MODULE_LIMIT)
        )
      : Promise.resolve([]),
    access.includes("DISPATCH_FMS")
      ? safe(() =>
          db
            .select()
            .from(dispatchActivities)
            .where(eq(dispatchActivities.orgId, orgId))
            .orderBy(desc(dispatchActivities.createdAt))
            .limit(PER_MODULE_LIMIT)
        )
      : Promise.resolve([]),
  ]);

  const merged: ActivityEntry[] = [
    ...leadRows.map((r) => ({
      id: r.id,
      module: "leads" as const,
      moduleLabel: "Lead",
      message: r.message,
      actorId: r.actorId,
      actorName: "",
      createdAt: r.createdAt.toISOString(),
      href: "/leads",
    })),
    ...orderRows.map((r) => ({
      id: r.id,
      module: "orders" as const,
      moduleLabel: "Order",
      message: r.message,
      actorId: r.actorId,
      actorName: "",
      createdAt: r.createdAt.toISOString(),
      href: "/orders",
    })),
    ...pdiRows.map((r) => ({
      id: r.id,
      module: "pdi" as const,
      moduleLabel: "PDI",
      message: r.message,
      actorId: r.actorId,
      actorName: "",
      createdAt: r.createdAt.toISOString(),
      href: "/pdi",
    })),
    ...tmsRows.map((r) => ({
      id: r.id,
      module: "tms" as const,
      moduleLabel: "TMS",
      message: r.message,
      actorId: r.actorId,
      actorName: "",
      createdAt: r.createdAt.toISOString(),
      href: "/tms",
    })),
    ...dispatchRows.map((r) => ({
      id: r.id,
      module: "dispatch" as const,
      moduleLabel: "Dispatch",
      message: r.message,
      actorId: r.actorId,
      actorName: "",
      createdAt: r.createdAt.toISOString(),
      href: "/dispatch",
    })),
  ]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);

  // Resolve actor names once, for the distinct set of ids actually shown — not one
  // lookup per row, and not for every row read before the slice.
  const actorIds = [...new Set(merged.map((e) => e.actorId).filter(Boolean))];
  const actorNames = new Map<string, string>();
  await Promise.all(
    actorIds.map(async (id) => {
      const user = await getUserById(id).catch(() => null);
      if (user) actorNames.set(id, user.Full_Name);
    })
  );

  return merged.map((e) => ({ ...e, actorName: actorNames.get(e.actorId) ?? "" }));
}
