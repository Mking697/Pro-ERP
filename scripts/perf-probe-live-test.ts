/**
 * Throwaway perf probe for the "loading skeleton 2-4s on Tasks/Inventory/Leads" item from
 * the 2026-10-02 frontend review. Seeds a real throwaway org with a realistic data volume
 * and times the exact aggregate functions each page's own API route calls, directly
 * against the real Neon DB (bypassing HTTP so the numbers are query/compute time, not
 * also Next.js/network overhead).
 *
 * Run: npx tsx scripts/perf-probe-live-test.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { runWithTenant } = await import("../src/lib/tenant");
  const { createOrganization, deleteOrganization } = await import("../src/lib/platform/registry");
  const { createUser } = await import("../src/lib/auth/users");
  const { createTask, listTasks } = await import("../src/lib/tasks");
  const { createItem } = await import("../src/lib/inventory/items");
  const { recordMovement } = await import("../src/lib/inventory/ledger");
  const { getInventorySnapshot } = await import("../src/lib/inventory/service");
  const { createLead, listLeads } = await import("../src/lib/leads/leads");

  const stamp = Date.now();
  const org = await createOrganization({
    orgName: `Perf Probe Org ${stamp}`,
    ownerEmail: `perf-probe-${stamp}@example.com`,
  });
  console.log(`Created org ${org.id}`);
  const ctx = { orgId: org.id, org };

  try {
    await runWithTenant(ctx, async () => {
      const user = await createUser({
        email: `perf-doer-${stamp}@example.com`,
        fullName: "Perf Doer",
        role: "Doer",
        password: "Test1234!",
        department: "",
        phoneNumber: "",
        createdBy: "perf-probe-script",
        moduleAccess: [],
      });

      const TASK_COUNT = 200;
      const ITEM_COUNT = 300;
      const LEAD_COUNT = 150;

      console.log(`\n--- Seeding ${TASK_COUNT} tasks ---`);
      let t0 = Date.now();
      for (let i = 0; i < TASK_COUNT; i++) {
        await createTask({
          title: `Perf Task ${i}`,
          description: "",
          assignedTo: user.User_ID,
          assignedBy: user.User_ID,
          priority: "Medium",
          dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 16),
          attachmentUrl: "",
          remark: "",
        });
      }
      console.log(`  seeded in ${Date.now() - t0}ms`);

      console.log(`\n--- Seeding ${ITEM_COUNT} items + 1 stock movement each ---`);
      t0 = Date.now();
      const skus: string[] = [];
      for (let i = 0; i < ITEM_COUNT; i++) {
        const item = await createItem({
          sku: `PERF-SKU-${stamp}-${i}`,
          itemName: `Perf Item ${i}`,
          category: "Raw Material",
          uom: "PCS",
          createdBy: `perf-doer-${stamp}@example.com`,
        });
        skus.push(item.SKU);
      }
      console.log(`  items seeded in ${Date.now() - t0}ms`);

      t0 = Date.now();
      for (const sku of skus) {
        await recordMovement({
          sku,
          direction: "In",
          quantity: 100,
          uom: "PCS",
          source: "Opening",
          userId: user.User_ID,
        }).catch((e) => console.log("movement err", (e as Error).message));
      }
      console.log(`  movements seeded in ${Date.now() - t0}ms`);

      console.log(`\n--- Seeding ${LEAD_COUNT} leads ---`);
      t0 = Date.now();
      for (let i = 0; i < LEAD_COUNT; i++) {
        await createLead({
          personName: `Contact ${i}`,
          phone: "9999999999",
          companyName: `Perf Lead Co ${i}`,
          source: "Website",
          assignedTo: user.User_ID,
          createdBy: user.User_ID,
        }).catch((e) => console.log("lead err", (e as Error).message));
      }
      console.log(`  leads seeded in ${Date.now() - t0}ms`);

      console.log("\n=== TIMING THE ACTUAL READ PATHS EACH PAGE CALLS ===");

      t0 = Date.now();
      const tasks = await listTasks();
      console.log(`listTasks()              : ${Date.now() - t0}ms for ${tasks.length} rows`);

      t0 = Date.now();
      const snapshot = await getInventorySnapshot();
      console.log(`getInventorySnapshot()    : ${Date.now() - t0}ms for ${snapshot.items.length} items / ${snapshot.ledger.length} ledger rows`);

      t0 = Date.now();
      const leads = await listLeads();
      console.log(`listLeads()               : ${Date.now() - t0}ms for ${leads.length} rows`);

      // Re-run each once more, back to back, to see if it's consistent (rules out a cold
      // Neon connection on the very first query skewing the numbers).
      console.log("\n--- Second pass (warm) ---");
      t0 = Date.now();
      await listTasks();
      console.log(`listTasks() (2nd)         : ${Date.now() - t0}ms`);
      t0 = Date.now();
      await getInventorySnapshot();
      console.log(`getInventorySnapshot() (2nd): ${Date.now() - t0}ms`);
      t0 = Date.now();
      await listLeads();
      console.log(`listLeads() (2nd)         : ${Date.now() - t0}ms`);
    });
  } finally {
    console.log("\n--- Cleanup ---");
    await deleteOrganization(org.id);
    console.log("Deleted throwaway org.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
