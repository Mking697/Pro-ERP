import { and, eq } from "drizzle-orm";
import { leaveQuotas, leaves } from "@/db/schema";
import { db } from "@/db/client";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";
import { todayIST } from "@/lib/dateUtil";

/**
 * Leave balance/quota (2026-09-22) — a simple flat annual day count per leave type, no
 * accrual and no carry-forward, by explicit user choice. Quotas are opt-in per org per
 * leave type: a leave type with no row in `leave_quotas` has no limit at all. Enforced at
 * filing time in `createLeave()` (src/lib/leave/leaves.ts) — see that file for the actual
 * gate; this file only computes the numbers.
 */

/** Inclusive day count between two "YYYY-MM-DD" strings (endDate - startDate + 1 calendar
 * days) — every leave in this schema is whole-day, no partial-day granularity anywhere. */
export function daysBetween(startDate: string, endDate: string): number {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const startUtc = Date.UTC(sy, sm - 1, sd);
  const endUtc = Date.UTC(ey, em - 1, ed);
  return Math.round((endUtc - startUtc) / 86_400_000) + 1;
}

/** Every configured quota for the org, keyed by leave type — a type with no row here has
 * no limit, so callers must treat a missing key as "unlimited", not zero. */
export async function getLeaveQuotas(): Promise<Record<string, number>> {
  const orgId = await getTenantOrgId();
  const rows = await db.select().from(leaveQuotas).where(eq(leaveQuotas.orgId, orgId));
  const map: Record<string, number> = {};
  for (const row of rows) {
    map[row.leaveType] = Number(row.annualDays);
  }
  return map;
}

/** Upserts a leave type's annual quota. `annualDays <= 0` (or blank) means "no quota" —
 * this deletes the row outright rather than storing a meaningless zero, so `getLeaveQuotas`
 * never needs to special-case a zero entry as "unlimited". */
export async function setLeaveQuota(leaveType: string, annualDays: number): Promise<void> {
  const orgId = await getTenantOrgId();
  if (!annualDays || annualDays <= 0) {
    await db
      .delete(leaveQuotas)
      .where(and(eq(leaveQuotas.orgId, orgId), eq(leaveQuotas.leaveType, leaveType)));
    return;
  }

  await db
    .insert(leaveQuotas)
    .values({ id: generateId("LQ"), orgId, leaveType, annualDays: String(annualDays) })
    .onConflictDoUpdate({
      target: [leaveQuotas.orgId, leaveQuotas.leaveType],
      set: { annualDays: String(annualDays) },
    });
}

/** Sums `daysBetween(startDate, endDate)` across every one of this doer's leaves of this
 * type, in the calendar year of the leave's own startDate — counting Pending as well as
 * Approved (never Rejected/Cancelled), so two simultaneous pending requests can't each be
 * evaluated as if only they existed, only for both to later be approved over quota. */
export async function getUsedDaysThisYear(
  doerId: string,
  leaveType: string,
  year: number
): Promise<number> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(leaves)
    .where(and(eq(leaves.orgId, orgId), eq(leaves.doerId, doerId), eq(leaves.leaveType, leaveType)));

  let total = 0;
  for (const row of rows) {
    if (row.status === "Rejected" || row.status === "Cancelled") continue;
    const rowYear = Number(row.startDate.slice(0, 4));
    if (rowYear !== year) continue;
    total += daysBetween(row.startDate, row.endDate);
  }
  return total;
}

/** Remaining balance for the CURRENT calendar year — `null` means unlimited (no quota
 * configured for this leave type), never a number, so callers can't accidentally treat
 * "unlimited" as "0 left". */
export async function getRemainingBalance(doerId: string, leaveType: string): Promise<number | null> {
  const quotas = await getLeaveQuotas();
  const quota = quotas[leaveType];
  if (!quota) return null;

  const year = Number(todayIST().slice(0, 4));
  const used = await getUsedDaysThisYear(doerId, leaveType, year);
  return quota - used;
}
