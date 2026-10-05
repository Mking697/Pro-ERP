import { describe, expect, it } from "vitest";
import { createItem } from "@/lib/inventory/items";
import { createCustomer, updateCustomer } from "@/lib/parties/customers";
import {
  createDirectOrder,
  recordPayment,
  workPaymentReview,
  OrderError,
} from "@/lib/orders/orders";
import { deleteOrganization, getOrganization } from "@/lib/platform/registry";
import { runWithTenant } from "@/lib/tenant";
import { makeTestOrg } from "./helpers/testOrg";

/**
 * computeCreditPosition() (src/lib/orders/orders.ts, private — exercised here only
 * through workPaymentReview()) used to sum each open order's payments with one sequential
 * query per order. It was rewritten to batch every open order's payments in a single
 * `inArray` query and group in memory. These tests exist to prove that rewrite computes
 * the exact same outstanding/hold decision as before — same math, just fewer round trips
 * — across the cases that actually exercise the aggregation: multiple open orders for one
 * customer, partial payments, and the credit-limit/overdue branches.
 */
describe("Payment_Review credit gate (computeCreditPosition batching)", () => {
  async function setupCustomerWithCredit(
    orgId: string,
    org: Awaited<ReturnType<typeof makeTestOrg>>,
    creditLimit: number | null,
    creditDays: number | null
  ) {
    const { customer } = await createCustomer({
      customerName: `Credit Customer ${org.id}`,
      createdBy: "SYSTEM",
    });
    await updateCustomer(customer.Customer_ID, { creditLimit, creditDays });
    return customer;
  }

  async function placeDirectOrder(customerId: string, orderValue: number) {
    const item = await createItem({
      itemName: `Widget ${Math.random().toString(36).slice(2, 8)}`,
      category: "FG",
      uom: "Nos",
      createdBy: "SYSTEM",
    });
    // orderValue = qty * rate * 1.18 (18% default GST) rounded — pick qty=1 and derive
    // rate so the resulting orderValue lands exactly on the value the test wants.
    const rate = round2Local(orderValue / 1.18);
    const order = await createDirectOrder(
      {
        customerId,
        items: [{ sku: item.SKU, qty: 1, rate }],
        transportArrangedBy: "Self",
        gstPercent: 18,
      },
      "SYSTEM"
    );
    return order;
  }

  function round2Local(n: number): number {
    return Math.round(n * 100) / 100;
  }

  it("holds credit when combined outstanding across multiple open orders exceeds the limit", async () => {
    const org = await makeTestOrg("CreditBatchLimit");
    try {
      await runWithTenant({ orgId: org.id, org }, async () => {
        const customer = await setupCustomerWithCredit(org.id, org, 1000, null);

        // Two open orders whose combined value exceeds the ₹1000 limit, neither alone
        // would trip it (₹600 + ₹600 = ₹1200 > ₹1000).
        const orderA = await placeDirectOrder(customer.Customer_ID, 600);
        const orderB = await placeDirectOrder(customer.Customer_ID, 600);

        // workPaymentReview() on orderB must see orderA's own outstanding balance too —
        // this is exactly what computeCreditPosition()'s batched payment sum has to get
        // right across more than one order for the same customer.
        const reviewedA = await workPaymentReview(orderA.id, "SYSTEM");
        expect(reviewedA.status).toBe("Credit_Hold");

        const reviewedB = await workPaymentReview(orderB.id, "SYSTEM");
        expect(reviewedB.status).toBe("Credit_Hold");
      });
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });

  it("passes credit check when a partial payment brings combined outstanding under the limit", async () => {
    const org = await makeTestOrg("CreditBatchPartialPay");
    try {
      await runWithTenant({ orgId: org.id, org }, async () => {
        const customer = await setupCustomerWithCredit(org.id, org, 1000, null);

        const orderA = await placeDirectOrder(customer.Customer_ID, 600);
        const orderB = await placeDirectOrder(customer.Customer_ID, 600);

        // Pay down most of orderA — batched sum must correctly net this against orderA's
        // own orderValue rather than, say, double-counting or dropping it when grouping
        // payments by order id in memory.
        await recordPayment(orderA.id, { amount: 500, mode: "Bank_Transfer" }, "SYSTEM");

        // Combined outstanding now: (600 - 500) + 600 = 700, under the ₹1000 limit.
        const reviewedB = await workPaymentReview(orderB.id, "SYSTEM");
        expect(reviewedB.status).toBe("Stock_Check");
      });
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });

  it("flags an order as overdue once its own creditDays window has passed, independent of other open orders", async () => {
    const org = await makeTestOrg("CreditBatchOverdue");
    try {
      await runWithTenant({ orgId: org.id, org }, async () => {
        // creditDays: 0 — any order with an outstanding balance is immediately "overdue"
        // (createdAt + 0 days is already in the past the instant it's created), so this
        // doesn't need to wait on real wall-clock time to exercise the overdue branch.
        const customer = await setupCustomerWithCredit(org.id, org, 100000, 0);
        const order = await placeDirectOrder(customer.Customer_ID, 500);

        const reviewed = await workPaymentReview(order.id, "SYSTEM");
        expect(reviewed.status).toBe("Credit_Hold");
      });
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });

  it("requires a real advance when the customer has no credit terms at all", async () => {
    const org = await makeTestOrg("CreditBatchNoCredit");
    try {
      await runWithTenant({ orgId: org.id, org }, async () => {
        const { customer } = await createCustomer({
          customerName: `No Credit Customer ${org.id}`,
          createdBy: "SYSTEM",
        });
        const order = await placeDirectOrder(customer.Customer_ID, 500);

        await expect(workPaymentReview(order.id, "SYSTEM")).rejects.toThrow(OrderError);

        await recordPayment(order.id, { amount: 1, mode: "Cash" }, "SYSTEM");
        const reviewed = await workPaymentReview(order.id, "SYSTEM");
        expect(reviewed.status).toBe("Stock_Check");
      });
    } finally {
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });
});
