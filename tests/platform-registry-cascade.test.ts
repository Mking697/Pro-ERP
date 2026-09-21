import { describe, expect, it } from "vitest";
import {
  fmsRuns,
  fmsTemplates,
  items,
  leaves,
  purchaseOrders,
  tasks,
  usersIndex,
  users,
  vendors,
} from "@/db/schema";
import { deleteOrganization, getOrganization } from "@/lib/platform/registry";
import { createUser } from "@/lib/auth/users";
import { runWithTenant } from "@/lib/tenant";
import { insertRecord, listByOrg } from "@/db/repo";
import { generateId } from "@/lib/id";
import { makeTestOrg } from "./helpers/testOrg";

/**
 * deleteOrganization()'s cascade has broken silently three separate times in this
 * project's history as new tenant tables were added (see CLAUDE.md) — this seeds a row in
 * one table from each of six different schema files (tasks, inventory, fms, leave,
 * parties, purchase) plus the platform-index tables createUser() itself writes, then
 * asserts the whole org disappears in one call with nothing left behind anywhere.
 */
describe("deleteOrganization cascade", () => {
  it("wipes every seeded row across tasks, inventory, fms, leave, parties and purchase", async () => {
    const org = await makeTestOrg("Cascade");

    try {
      await runWithTenant({ orgId: org.id, org }, async () => {
        const user = await createUser({
          fullName: "Cascade Doer",
          email: `cascade-doer-${org.id}@example.com`,
          password: "Password123!",
          role: "Staff",
          department: "Ops",
          phoneNumber: "9990000099",
          createdBy: "SYSTEM",
        });

        await insertRecord(tasks, {
          id: generateId("TSK"),
          orgId: org.id,
          title: "Cascade Task",
          assignedTo: user.User_ID,
          assignedBy: user.User_ID,
          taskType: "One-Time",
        });

        await insertRecord(items, {
          sku: generateId("SKU"),
          orgId: org.id,
          itemName: "Cascade Item",
        });

        await insertRecord(fmsTemplates, {
          templateId: generateId("TPL"),
          orgId: org.id,
          templateName: "Cascade Template",
          triggerEvent: "MANUAL",
          stepNo: 1,
          stepName: "Step 1",
        });

        await insertRecord(fmsRuns, {
          id: generateId("RUN"),
          orgId: org.id,
          instanceId: generateId("INS"),
          templateId: generateId("TPL"),
          stepNo: 1,
          stepName: "Step 1",
        });

        await insertRecord(leaves, {
          id: generateId("LV"),
          orgId: org.id,
          doerId: user.User_ID,
          startDate: "2026-01-01",
          endDate: "2026-01-02",
        });

        await insertRecord(vendors, {
          id: generateId("VEN"),
          orgId: org.id,
          vendorName: "Cascade Vendor",
        });

        await insertRecord(purchaseOrders, {
          id: generateId("PO"),
          orgId: org.id,
          vendorId: generateId("VEN"),
        });
      });

      // Sanity check: the rows genuinely landed before we test that they genuinely leave.
      expect(await listByOrg(tasks, org.id)).toHaveLength(1);
      expect(await listByOrg(users, org.id)).toHaveLength(1);

      await expect(deleteOrganization(org.id)).resolves.not.toThrow();

      expect(await getOrganization(org.id)).toBeNull();
      expect(await listByOrg(tasks, org.id)).toHaveLength(0);
      expect(await listByOrg(items, org.id)).toHaveLength(0);
      expect(await listByOrg(fmsTemplates, org.id)).toHaveLength(0);
      expect(await listByOrg(fmsRuns, org.id)).toHaveLength(0);
      expect(await listByOrg(leaves, org.id)).toHaveLength(0);
      expect(await listByOrg(vendors, org.id)).toHaveLength(0);
      expect(await listByOrg(purchaseOrders, org.id)).toHaveLength(0);
      expect(await listByOrg(users, org.id)).toHaveLength(0);
      expect(await listByOrg(usersIndex, org.id)).toHaveLength(0);
    } finally {
      // Self-healing cleanup: if deleteOrganization() already ran (the happy path above),
      // this is a harmless no-op catch; if something threw before it ran, this still
      // leaves no orphaned org behind.
      if (await getOrganization(org.id)) {
        await deleteOrganization(org.id).catch(() => {});
      }
    }
  });
});
