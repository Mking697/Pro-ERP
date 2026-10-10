/**
 * MARKETING DEMO SEED — isolated under /marketing, not part of the production app.
 *
 * Creates a throwaway organization with realistic but entirely fictional data
 * (fake company name, fake people, fake phone numbers using the reserved 999-xxxxxxx
 * block, fake amounts) purely so the marketing video/screenshot capture has a populated,
 * believable UI to show. No real customer/business data is used anywhere.
 *
 * Usage:
 *   cd G:/Pro-ERP
 *   npx tsx marketing/scripts-seed/seed-demo-org.ts
 *
 * Prints the created org's admin login email + a fixed demo password at the end —
 * use those to log in locally at http://localhost:3000/login for screenshots.
 *
 * This script is NEVER run against production and does not touch any existing data —
 * it only INSERTs a brand-new org via the same createOrganization()/createUser() paths
 * every real signup uses.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const DEMO_PASSWORD = "DemoPass123!";

function ok(msg: string) {
  console.log(`  OK: ${msg}`);
}

async function main() {
  const { runWithTenant } = await import("../../src/lib/tenant");
  const { createOrganization } = await import("../../src/lib/platform/registry");
  const { createUser } = await import("../../src/lib/auth/users");
  const { createItem } = await import("../../src/lib/inventory/items");
  const { createBom } = await import("../../src/lib/inventory/bom");
  const { createVendor } = await import("../../src/lib/parties/vendors");
  const { createCustomer } = await import("../../src/lib/parties/customers");
  const { recordMovement } = await import("../../src/lib/inventory/ledger");
  const { createLead } = await import("../../src/lib/leads/leads");
  const { createDirectOrder } = await import("../../src/lib/orders/orders");
  const { createTask } = await import("../../src/lib/tasks");
  const { createPlans } = await import("../../src/lib/inventory/plans");

  const stamp = Date.now();
  const org = await createOrganization({
    orgName: "Orion Auto Components",
    ownerEmail: `demo-admin-${stamp}@orion-demo.local`,
  });
  console.log(`\nCreated demo org: ${org.id} (${org.orgName})`);

  const ctx = { orgId: org.id, org };

  await runWithTenant(ctx, async () => {
    // --- Admin + staff users ---
    const admin = await createUser({
      fullName: "Aditi Rao",
      email: `demo-admin-${stamp}@orion-demo.local`,
      password: DEMO_PASSWORD,
      role: "Admin",
      department: "Management",
      phoneNumber: "9990001001",
      createdBy: "SYSTEM",
    });
    ok(`admin user ${admin.User_ID} (${admin.Email})`);

    const productionStaff = await createUser({
      fullName: "Rahul Mehta",
      email: `demo-production-${stamp}@orion-demo.local`,
      password: DEMO_PASSWORD,
      role: "Staff",
      department: "Production",
      phoneNumber: "9990001002",
      createdBy: "SYSTEM",
      moduleAccess: ["PPC_PLAN", "BOM_MANAGE", "INVENTORY_VIEW", "INVENTORY_TXN"],
    });
    ok(`production staff ${productionStaff.User_ID}`);

    const salesStaff = await createUser({
      fullName: "Priya Nair",
      email: `demo-sales-${stamp}@orion-demo.local`,
      password: DEMO_PASSWORD,
      role: "Staff",
      department: "Sales",
      phoneNumber: "9990001003",
      createdBy: "SYSTEM",
      moduleAccess: ["LEAD_FMS", "ORDER_FMS"],
    });
    ok(`sales staff ${salesStaff.User_ID}`);

    // --- Items + BOM ---
    const steelRod = await createItem({
      itemName: "Alloy Steel Rod 12mm",
      category: "RM",
      uom: "Kg",
      createdBy: "SYSTEM",
    });
    const bracket = await createItem({
      itemName: "Precision Mounting Bracket",
      category: "FG",
      uom: "Pcs",
      createdBy: "SYSTEM",
    });
    ok(`items: RM=${steelRod.SKU}, FG=${bracket.SKU}`);

    await createBom({
      productName: "Precision Mounting Bracket",
      productSku: bracket.SKU,
      lines: [
        {
          componentSku: steelRod.SKU,
          componentName: steelRod.Item_Name,
          qtyPerUnit: 0.8,
          uom: "Kg",
        },
      ],
      createdBy: "SYSTEM",
    });
    ok("BOM created for Precision Mounting Bracket");

    await recordMovement({
      sku: steelRod.SKU,
      direction: "In",
      quantity: 5000,
      uom: "Kg",
      source: "Opening",
      remark: "Demo opening stock",
      userId: "SYSTEM",
    });
    ok("opening stock: 5000 Kg Alloy Steel Rod");

    // --- Vendor + Customer ---
    const { vendor } = await createVendor({
      vendorName: "Shree Metal Traders",
      contactPerson: "Vikram Shah",
      phone: "9990002001",
      createdBy: "SYSTEM",
    });
    ok(`vendor ${vendor.Vendor_ID}`);

    const { customer } = await createCustomer({
      customerName: "Nexora Auto Pvt Ltd",
      contactPerson: "Sanjay Verma",
      phone: "9990003001",
      email: "purchase@nexora-demo.local",
      city: "Pune",
      state: "Maharashtra",
      creditTerms: "30 Days",
      createdBy: "SYSTEM",
    } as never);
    ok(`customer ${(customer as { Customer_ID?: string }).Customer_ID ?? "created"}`);

    // --- Leads at different pipeline stages ---
    const leadNames = [
      { name: "Kavya Automotive Works", city: "Chennai", source: "Website" },
      { name: "TurboTech Fabricators", city: "Ahmedabad", source: "Referral" },
      { name: "Starline Industries", city: "Coimbatore", source: "Trade Show" },
    ];
    for (const l of leadNames) {
      const { lead } = await createLead({
        personName: l.name,
        phone: "9990004" + Math.floor(100 + Math.random() * 899),
        companyName: l.name,
        city: l.city,
        state: "",
        source: l.source,
        productInterest: "Precision Mounting Bracket",
        assignedTo: salesStaff.User_ID,
        createdBy: salesStaff.User_ID,
      } as never);
      ok(`lead ${lead.id} (${l.name})`);
    }

    // --- A direct order (safe demo amounts) ---
    try {
      const order = await createDirectOrder(
        {
          customerId: (customer as { Customer_ID?: string }).Customer_ID,
          items: [{ sku: bracket.SKU, qty: 500, rate: 420 }],
          transportArrangedBy: "Self",
          gstPercent: 18,
        } as never,
        salesStaff.User_ID
      );
      ok(`direct order ${(order as { id?: string }).id ?? "created"}`);
    } catch (e) {
      console.log(`  (order creation skipped: ${(e as Error).message})`);
    }

    // --- Tasks ---
    await createTask({
      title: "Weekly machine maintenance check",
      description: "Inspect CNC line 2 for wear and lubrication",
      assignedTo: productionStaff.User_ID,
      assignedBy: admin.User_ID,
      priority: "High",
      dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      attachmentUrl: "",
      remark: "",
    } as never);
    await createTask({
      title: "Follow up with Nexora Auto on PO",
      description: "Confirm delivery schedule for bracket order",
      assignedTo: salesStaff.User_ID,
      assignedBy: admin.User_ID,
      priority: "Medium",
      dueDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString(),
      attachmentUrl: "",
      remark: "",
    } as never);
    ok("2 demo tasks created");

    // --- Production plan ---
    try {
      await createPlans(
        [
          {
            productSku: bracket.SKU,
            plannedQty: 500,
            productionDate: new Date().toISOString(),
          },
        ] as never,
        productionStaff.User_ID
      );
      ok("production plan created");
    } catch (e) {
      console.log(`  (production plan skipped: ${(e as Error).message})`);
    }
  });

  console.log("\n===============================================");
  console.log("DEMO ORG READY");
  console.log("===============================================");
  console.log(`Org:      ${org.orgName} (${org.id})`);
  console.log(`Login:    http://localhost:3000/login`);
  console.log(`Email:    demo-admin-${stamp}@orion-demo.local`);
  console.log(`Password: ${DEMO_PASSWORD}`);
  console.log("===============================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("SEED FAILED:", err);
    process.exit(1);
  });
