import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

const boundary = vi.hoisted(() => ({ failPdi: false, observedActive: [] as boolean[] }));
// The real Orders -> PDI path and all SQL execute. Inject only a late DB successor
// failure, AFTER its insert, to prove earlier reservations/activity roll back too.
vi.mock("@/db/client", async (actual) => {
  const real = await actual<typeof import("@/db/client")>();
  const { pdiActivities } = await import("@/db/schema");
  return { ...real, db: new Proxy(real.db, { get(target, key) {
    if (key === "insert") return (table: Parameters<typeof target.insert>[0]) => {
      const builder = target.insert(table);
      if (table !== pdiActivities) return builder;
      return { values: (values: Parameters<typeof builder.values>[0]) => ({
        async returning() {
          boundary.observedActive.push(real.isInTenantTransaction());
          const rows = await builder.values(values).returning();
          if (boundary.failPdi) throw new Error("late PDI successor failure");
          return rows;
        },
      }) };
    };
    return Reflect.get(target, key);
  } }) };
});
vi.mock("@/lib/chatxflow", () => ({ sendWhatsAppMessage: vi.fn() }));

import { db, runInTenantTransaction, afterTenantCommit, isInTenantTransaction } from "@/db/client";
import { organizations, orders, orderItems, orderActivities, pdiInspections, pdiActivities, stockLedger, mutationReceipts } from "@/db/schema";
import { runWithTenant, type TenantContext } from "@/lib/tenant";
import { runIdempotentTenantMutation } from "@/lib/mutations";
import { recordMovement, recordMovementsBulk } from "@/lib/inventory/ledger";

let orgId: string;
let orderId: string;
const movement = () => ({ sku: "FG", direction: "In" as const, quantity: 2, uom: "pcs", source: "Manual" as const, userId: "test-user" });
function tenant<T>(work: () => Promise<T>) { return runWithTenant({ orgId } as TenantContext, work); }
async function state() {
  return {
    ledger: await db.select().from(stockLedger).where(eq(stockLedger.orgId, orgId)),
    lines: await db.select().from(orderItems).where(eq(orderItems.orgId, orgId)),
    activities: await db.select().from(orderActivities).where(eq(orderActivities.orgId, orgId)),
    pdi: await db.select().from(pdiActivities).where(eq(pdiActivities.orgId, orgId)),
    receipts: await db.select().from(mutationReceipts).where(eq(mutationReceipts.orgId, orgId)),
  };
}
beforeEach(async () => {
  expect(process.env.DATABASE_URL).toBe("postgresql://pro_erp_test@pro-erp-regression-pg:5432/pro_erp_test?sslmode=disable");
  orgId = `stock-in-atomic-${randomUUID()}`;
  orderId = `${orgId}-order`;
  boundary.failPdi = false; boundary.observedActive = [];
  await db.insert(organizations).values({ id: orgId, orgName: "Disposable atomic stock-in", slug: orgId, ownerEmail: "atomic@example.invalid" });
  await db.insert(orders).values({ id: orderId, orgId, status: "Ready_For_PDI", pdiId: `${orgId}-pdi` });
  await db.insert(orderItems).values({ orderId, orgId, lineNo: "1", sku: "FG", qty: "2", reservedQty: "0", consumedQty: "0", shortageQty: "2" });
  await db.insert(pdiInspections).values({ id: `${orgId}-pdi`, orgId, orderId, status: "Pending" });
});
afterEach(async () => {
  boundary.failPdi = false;
  for (const table of [mutationReceipts, pdiActivities, pdiInspections, orderActivities, orderItems, orders, stockLedger]) {
    await db.delete(table).where(eq(table.orgId, orgId));
    expect(await db.select().from(table).where(eq(table.orgId, orgId))).toEqual([]);
  }
  await db.delete(organizations).where(eq(organizations.id, orgId));
  expect(await db.select().from(organizations).where(eq(organizations.id, orgId))).toEqual([]);
});
it("single stock-in rolls back real Order/PDI successors and receipt, then retries once", async () => {
  const receive = () => tenant(() => runIdempotentTenantMutation(orgId, {
    key: "receipt-retry", actorId: "test-user", operation: "test.stock-in.v1", payload: movement(),
  }, async () => ({ ...await recordMovement(movement()) })));
  boundary.failPdi = true;
  await expect(receive()).rejects.toThrow("late PDI successor failure");
  const failed = await state();
  expect(failed.ledger).toEqual([]); expect(failed.activities).toEqual([]);
  expect(failed.pdi).toEqual([]); expect(failed.receipts).toEqual([]);
  expect(failed.lines[0]).toMatchObject({ reservedQty: "0", shortageQty: "2" });
  expect(boundary.observedActive).toEqual([true]);
  boundary.failPdi = false;
  const first = await receive(); expect(await receive()).toEqual(first);
  const committed = await state();
  expect(committed.ledger).toHaveLength(1); expect(committed.activities).toHaveLength(1);
  expect(committed.pdi).toHaveLength(1); expect(committed.receipts).toHaveLength(1);
  expect(committed.lines[0]).toMatchObject({ reservedQty: "2", shortageQty: "0" });
  expect(boundary.observedActive).toEqual([true, true]);
});
it("bulk stock-in rolls back every movement when its real PDI successor fails", async () => {
  boundary.failPdi = true;
  await expect(tenant(() => recordMovementsBulk([
    { ...movement(), quantity: 1 }, { ...movement(), quantity: 1 },
    { ...movement(), sku: "OTHER", quantity: 3 },
  ]))).rejects.toThrow("late PDI successor failure");
  const failed = await state();
  expect(failed.ledger).toEqual([]); expect(failed.activities).toEqual([]);
  expect(failed.pdi).toEqual([]);
  expect(failed.lines[0]).toMatchObject({ reservedQty: "0", shortageQty: "2" });
  expect(boundary.observedActive).toEqual([true]);
});
it("outer failure rolls back already successful real successors and suppresses external effects", async () => {
  const before = await state();
  const notify = vi.fn();
  await expect(tenant(() => runInTenantTransaction(orgId, async () => {
    await recordMovement(movement());
    const inside = await state();
    expect(inside.lines[0]).toMatchObject({ reservedQty: "2", shortageQty: "0" });
    expect(inside.activities).toHaveLength(1); expect(inside.pdi).toHaveLength(1);
    expect(boundary.observedActive).toEqual([true]);
    await afterTenantCommit(notify);
    expect(notify).not.toHaveBeenCalled();
    throw new Error("outer stock command failed");
  }))).rejects.toThrow("outer stock command failed");
  expect(await state()).toEqual(before);
  expect(notify).not.toHaveBeenCalled();
});
it("receipt reserves oldest Order before a competing issue under the common tenant lock", async () => {
  const younger = `${orgId}-younger`;
  await db.update(orders).set({ createdAt: new Date("2026-01-01") }).where(eq(orders.id, orderId));
  await db.insert(orders).values({ id: younger, orgId, status: "Stock_Check", createdAt: new Date("2026-01-02") });
  await db.insert(orderItems).values({ orderId: younger, orgId, lineNo: "1", sku: "FG", qty: "2", shortageQty: "2" });
  let ready!: () => void; let release!: () => void;
  const received = new Promise<void>((resolve) => { ready = resolve; });
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const notify = vi.fn();
  const receiving = tenant(() => runInTenantTransaction(orgId, async () => {
    try {
      await recordMovement(movement());
      expect(isInTenantTransaction()).toBe(true);
      const inside = await state();
      expect(inside.lines.find((row) => row.orderId === orderId)).toMatchObject({ reservedQty: "2", shortageQty: "0" });
      expect(inside.lines.find((row) => row.orderId === younger)).toMatchObject({ reservedQty: "0", shortageQty: "2" });
      expect(inside.activities).toHaveLength(1); expect(inside.pdi).toHaveLength(1);
      await afterTenantCommit(notify);
      expect(notify).not.toHaveBeenCalled();
    } finally { ready(); }
    await hold;
  }));
  // Attach immediately so a failed assertion cannot become an unhandled rejection.
  const receiptResult = Promise.allSettled([receiving]);
  await received;
  let issueResult: ReturnType<typeof Promise.allSettled> | undefined;
  try {
    expect((await state()).ledger).toEqual([]); // Independent HTTP read: no premature COMMIT.
    const lock = await db.execute(sql`select pg_try_advisory_xact_lock(hashtextextended(${orgId}, 0)) as acquired`);
    expect(lock.rows[0].acquired).toBe(false);
    issueResult = Promise.allSettled([tenant(() => recordMovement({ ...movement(), direction: "Out", quantity: 1 }))]);
  } finally { release(); }
  expect((await receiptResult)[0].status).toBe("fulfilled");
  const [issue] = await issueResult!;
  expect(issue.status).toBe("rejected");
  if (issue.status === "rejected") expect(issue.reason.message).toMatch(/stock/i);
  const committed = await state();
  expect(committed.ledger).toHaveLength(1);
  expect(committed.lines.find((row) => row.orderId === orderId)).toMatchObject({ reservedQty: "2", shortageQty: "0" });
  expect(committed.lines.find((row) => row.orderId === younger)).toMatchObject({ reservedQty: "0", shortageQty: "2" });
  expect(notify).toHaveBeenCalledTimes(1);
});
