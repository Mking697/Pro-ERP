/**
 * Live test for getCreditRiskReport() (src/lib/accounts/accounts.ts) — the per-customer
 * credit-limit-vs-aging cross-check named in CLAUDE.md's "What's still actually open" list
 * as Receivables Aging's own natural next step.
 *
 * Builds three customers through a real order -> invoice -> payment flow (createDirectOrder
 * -> recordPayment -> workPaymentReview -> runStockCheck -> commitDispatch ->
 * punchOrderIntoPdi -> inspect(Pass) -> createInvoice -> issueInvoice), exactly the chain
 * getReceivablesAging() itself reads:
 *
 *   1. "Over Limit Co"  — real Issued invoice, outstanding ends up well above a creditLimit
 *      set (after the fact, via a direct customers.creditLimit patch — there is no
 *      updateCustomer()/credit-terms-edit API in this codebase yet, only createCustomer(),
 *      so this is the only way to set it on an existing row; a real gap worth flagging, not
 *      one this task was scoped to close) below what's actually owed. Must show overLimit.
 *   2. "Safe Co"        — same flow, small order value, creditLimit set comfortably above
 *      the real outstanding. Must NOT show as at-risk.
 *   3. "Old Debt Co"    — outstanding safely under its own creditLimit, but its one invoice
 *      is backdated >90 days so getReceivablesAging() buckets it as "90+". Must show
 *      hasOverdue90 = true / atRisk = true even though overLimit is false — proving the two
 *      flags are independent, not just aliases of each other.
 *   4. "No Credit Co"   — a customer with creditLimit left null (the default — nothing in
 *      this codebase ever sets it without a human explicitly doing so). Must be entirely
 *      absent from getCreditRiskReport()'s own rows, proving the "only customers who have
 *      actually been extended credit" filter works.
 *
 * Also spot-checks that getCreditRiskReport()'s own totalOutstanding/atRiskCount match what
 * the four rows above individually imply, and that it never recomputes outstanding a third
 * way (it must agree with getReceivablesAging()'s own numbers for the same customers).
 *
 * Run: npx tsx scripts/credit-risk-live-test.ts   (from repo root)
 */
import { config } from "dotenv";
config({ path: ".env.local" });

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}
function ok(msg: string) {
  console.log(`  OK: ${msg}`);
}

async function main() {
  const { runWithTenant } = await import("../src/lib/tenant");
  const { createOrganization, deleteOrganization } = await import("../src/lib/platform/registry");
  const { createUser } = await import("../src/lib/auth/users");
  const { createItem } = await import("../src/lib/inventory/items");
  const { recordMovement } = await import("../src/lib/inventory/ledger");
  const { createCustomer } = await import("../src/lib/parties/customers");
  const {
    createDirectOrder,
    recordPayment,
    workPaymentReview,
    runStockCheck,
    commitDispatch,
  } = await import("../src/lib/orders/orders");
  const { punchOrderIntoPdi, inspect: inspectPdi } = await import("../src/lib/pdi/pdi");
  const {
    createInvoice,
    issueInvoice,
    getInvoiceSuggestion,
    getReceivablesAging,
    getCreditRiskReport,
  } = await import("../src/lib/accounts/accounts");
  const { updateById } = await import("../src/db/repo");
  const { db } = await import("../src/db/client");
  const { customers, invoices } = await import("../src/db/schema");
  const { eq, and } = await import("drizzle-orm");

  const stamp = Date.now();
  const org = await createOrganization({
    orgName: `Credit Risk Test Org ${stamp}`,
    ownerEmail: `credit-risk-test-${stamp}@example.com`,
  });
  console.log(`Created org ${org.id}`);
  const ctx = { orgId: org.id, org };

  try {
    await runWithTenant(ctx, async () => {
      console.log("\n--- Setup: user, item, opening stock ---");
      const admin = await createUser({
        fullName: "Admin",
        email: `admin-${stamp}@example.com`,
        password: "Password123!",
        role: "Admin",
        department: "Accounts",
        phoneNumber: "",
        createdBy: "system",
      });
      const actorId = admin.User_ID;

      const fgItem = await createItem({
        itemName: "Credit Risk Test FG",
        category: "FG",
        uom: "Pcs",
        createdBy: "SYSTEM",
      });
      await recordMovement({
        sku: fgItem.SKU,
        direction: "In",
        quantity: 1000,
        uom: "Pcs",
        source: "Opening",
        remark: "Opening stock for credit-risk live test",
        userId: "SYSTEM",
      });
      ok(`created item ${fgItem.SKU}, 1000 Pcs opening stock`);

      // Drives one customer all the way from a Direct order through to an Issued invoice
      // with a real partial payment — the exact chain getReceivablesAging() reads.
      async function buildInvoicedOrder(customerId: string, orderValue: number, advance: number) {
        const order = await createDirectOrder(
          {
            customerId,
            items: [{ sku: fgItem.SKU, qty: 1, rate: orderValue }],
            transportArrangedBy: "Self",
            gstPercent: 0,
          },
          actorId
        );
        await recordPayment(order.id, { amount: advance, mode: "Cash" }, actorId);
        // No creditLimit is set on the customer yet at this point (see buildCustomer below),
        // so workPaymentReview takes the "no credit extended, just needs an advance" branch
        // — computeCreditPosition()'s own limit/overdue check never runs here, deliberately:
        // this script is testing the NEW cross-check report, not the existing gate.
        await workPaymentReview(order.id, actorId);
        await runStockCheck(order.id, actorId);
        await commitDispatch(order.id, new Date().toISOString(), actorId);
        const pdi = await punchOrderIntoPdi(order.id, actorId);
        await inspectPdi(pdi.id, { result: "Pass" }, actorId);

        const suggestion = await getInvoiceSuggestion(order.id);
        const invoice = await createInvoice(
          {
            orderId: order.id,
            invoiceNo: `INV-TEST-${order.id}`,
            invoiceAttachmentUrl: "https://example.com/test-invoice.pdf",
            finalValue: suggestion.suggestedFinalValue,
          },
          actorId
        );
        await issueInvoice(invoice.id, actorId);
        return { orderId: order.id, invoiceId: invoice.id };
      }

      console.log("\n--- 1. Over Limit Co: real outstanding well above its own credit limit ---");
      const overLimitCustomer = await createCustomer({
        customerName: `Over Limit Co ${stamp}`,
        createdBy: actorId,
      });
      const overLimitOrder = await buildInvoicedOrder(overLimitCustomer.customer.Customer_ID, 15000, 100);
      // Only way to set creditLimit/creditDays on an existing customer in this codebase
      // today — there is no updateCustomer()/credit-terms-edit API, only createCustomer(),
      // which doesn't even accept these two fields. Flagged in this script's own header.
      await updateById(customers, org.id, overLimitCustomer.customer.Customer_ID, {
        creditLimit: "10000",
        creditDays: 30,
      });
      ok(`Over Limit Co: order ${overLimitOrder.orderId}, invoice ${overLimitOrder.invoiceId}, creditLimit set to 10000 after the fact`);

      console.log("\n--- 2. Safe Co: real outstanding comfortably under its own credit limit ---");
      const safeCustomer = await createCustomer({
        customerName: `Safe Co ${stamp}`,
        createdBy: actorId,
      });
      const safeOrder = await buildInvoicedOrder(safeCustomer.customer.Customer_ID, 5000, 100);
      await updateById(customers, org.id, safeCustomer.customer.Customer_ID, {
        creditLimit: "50000",
        creditDays: 30,
      });
      ok(`Safe Co: order ${safeOrder.orderId}, invoice ${safeOrder.invoiceId}, creditLimit set to 50000`);

      console.log("\n--- 3. Old Debt Co: within its own limit, but its one invoice is 90+ days old ---");
      const oldDebtCustomer = await createCustomer({
        customerName: `Old Debt Co ${stamp}`,
        createdBy: actorId,
      });
      const oldDebtOrder = await buildInvoicedOrder(oldDebtCustomer.customer.Customer_ID, 2000, 100);
      await updateById(customers, org.id, oldDebtCustomer.customer.Customer_ID, {
        creditLimit: "100000",
        creditDays: 30,
      });
      const backdatedTo = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      await db
        .update(invoices)
        .set({ issuedAt: backdatedTo })
        .where(and(eq(invoices.orgId, org.id), eq(invoices.id, oldDebtOrder.invoiceId)));
      ok(`Old Debt Co: order ${oldDebtOrder.orderId}, invoice ${oldDebtOrder.invoiceId} backdated to ${backdatedTo.toISOString().slice(0, 10)}`);

      console.log("\n--- 4. No Credit Co: creditLimit left null — must not appear in the report at all ---");
      const noCreditCustomer = await createCustomer({
        customerName: `No Credit Co ${stamp}`,
        createdBy: actorId,
      });
      ok(`No Credit Co: ${noCreditCustomer.customer.Customer_ID}, no creditLimit ever set`);

      console.log("\n--- Verify against getReceivablesAging() (the shared source this report reuses) ---");
      const aging = await getReceivablesAging();
      const agingByCustomer = new Map<string, number>();
      for (const row of aging.rows) {
        if (!row.customerId) continue;
        agingByCustomer.set(row.customerId, (agingByCustomer.get(row.customerId) ?? 0) + row.outstanding);
      }
      const expectedOverLimitOutstanding = agingByCustomer.get(overLimitCustomer.customer.Customer_ID) ?? 0;
      const expectedSafeOutstanding = agingByCustomer.get(safeCustomer.customer.Customer_ID) ?? 0;
      const expectedOldDebtOutstanding = agingByCustomer.get(oldDebtCustomer.customer.Customer_ID) ?? 0;
      assert(expectedOverLimitOutstanding > 10000, "sanity: Over Limit Co's own aging outstanding must exceed 10000");
      assert(expectedSafeOutstanding < 50000, "sanity: Safe Co's own aging outstanding must be under 50000");
      ok(
        `Aging outstanding — Over Limit Co ₹${expectedOverLimitOutstanding}, Safe Co ₹${expectedSafeOutstanding}, Old Debt Co ₹${expectedOldDebtOutstanding}`
      );

      console.log("\n--- Verify getCreditRiskReport() ---");
      const report = await getCreditRiskReport();

      const overLimitRow = report.rows.find((r) => r.customerId === overLimitCustomer.customer.Customer_ID);
      const safeRow = report.rows.find((r) => r.customerId === safeCustomer.customer.Customer_ID);
      const oldDebtRow = report.rows.find((r) => r.customerId === oldDebtCustomer.customer.Customer_ID);
      const noCreditRow = report.rows.find((r) => r.customerId === noCreditCustomer.customer.Customer_ID);

      assert(overLimitRow !== undefined, "Over Limit Co must appear in the credit risk report");
      assert(
        overLimitRow!.outstanding === expectedOverLimitOutstanding,
        `Over Limit Co's outstanding must match Aging's own number exactly (report=${overLimitRow!.outstanding}, aging=${expectedOverLimitOutstanding}) — no third computation`
      );
      assert(overLimitRow!.overLimit === true, "Over Limit Co must be flagged overLimit");
      assert(overLimitRow!.atRisk === true, "Over Limit Co must be flagged atRisk");
      ok(`Over Limit Co: outstanding ₹${overLimitRow!.outstanding} vs limit ₹${overLimitRow!.creditLimit} -> overLimit=${overLimitRow!.overLimit}, atRisk=${overLimitRow!.atRisk}`);

      assert(safeRow !== undefined, "Safe Co must appear in the credit risk report");
      assert(
        safeRow!.outstanding === expectedSafeOutstanding,
        `Safe Co's outstanding must match Aging's own number exactly (report=${safeRow!.outstanding}, aging=${expectedSafeOutstanding})`
      );
      assert(safeRow!.overLimit === false, "Safe Co must NOT be flagged overLimit");
      assert(safeRow!.hasOverdue90 === false, "Safe Co must NOT be flagged hasOverdue90");
      assert(safeRow!.atRisk === false, "Safe Co must NOT be flagged atRisk");
      ok(`Safe Co: outstanding ₹${safeRow!.outstanding} vs limit ₹${safeRow!.creditLimit} -> atRisk=${safeRow!.atRisk} (correctly safe)`);

      assert(oldDebtRow !== undefined, "Old Debt Co must appear in the credit risk report");
      assert(oldDebtRow!.overLimit === false, "Old Debt Co must NOT be flagged overLimit (well within its own limit)");
      assert(oldDebtRow!.hasOverdue90 === true, "Old Debt Co must be flagged hasOverdue90 (its invoice is 100 days old)");
      assert(oldDebtRow!.over90 > 0, "Old Debt Co's over90 amount must be positive");
      assert(oldDebtRow!.atRisk === true, "Old Debt Co must be flagged atRisk via the 90+ path alone, independent of overLimit");
      ok(`Old Debt Co: overLimit=${oldDebtRow!.overLimit}, hasOverdue90=${oldDebtRow!.hasOverdue90}, over90=₹${oldDebtRow!.over90} -> atRisk=${oldDebtRow!.atRisk}`);

      assert(noCreditRow === undefined, "No Credit Co must be entirely absent — it was never extended credit");
      ok("No Credit Co correctly absent from the report");

      assert(report.atRiskCount === 2, `atRiskCount must be exactly 2 (Over Limit Co + Old Debt Co), got ${report.atRiskCount}`);
      const expectedTotal = (overLimitRow!.outstanding + safeRow!.outstanding + oldDebtRow!.outstanding);
      assert(
        Math.abs(report.totalOutstanding - expectedTotal) < 0.01,
        `totalOutstanding must equal the sum of the three credit customers' own outstanding (report=${report.totalOutstanding}, expected=${expectedTotal})`
      );
      ok(`atRiskCount=${report.atRiskCount}, totalOutstanding=₹${report.totalOutstanding}`);
    });

    console.log("\nAll assertions passed.");
  } finally {
    console.log("\n--- Cleanup ---");
    await deleteOrganization(org.id);
    console.log(`Deleted organization ${org.id}.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFAILED:", err);
    process.exit(1);
  });
