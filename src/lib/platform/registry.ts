import { eq, type InferSelectModel } from "drizzle-orm";
import { db } from "@/db/client";
import {
  billPayments,
  bills,
  bom,
  chartOfAccounts,
  customers,
  dispatchActivities,
  dispatches,
  failureLog,
  fmsRuns,
  fmsTemplates,
  fmsWeekoffOverrides,
  holidayList,
  imsInward,
  indents,
  invoices,
  inwardIqcFms,
  items,
  journalEntries,
  journalLines,
  leadActivities,
  leads,
  leaveApprovals,
  leaveApprovalSteps,
  leaveQuotas,
  leaveReassignments,
  leaves,
  orderActivities,
  orderItems,
  orderPayments,
  orders,
  organizations,
  payrollRuns,
  payslips,
  pdiActivities,
  pdiInspections,
  planMaterials,
  productionPlans,
  purchaseOrderLines,
  purchaseOrders,
  quotationItems,
  quotations,
  recurringTasks,
  reportShares,
  salaryStructures,
  settings,
  stockLedger,
  tasks,
  tmsActivities,
  tmsShipmentItems,
  tmsShipments,
  transportVendors,
  users,
  usersIndex,
  vendorItems,
  vendors,
} from "@/db/schema";
import { generateId, slugify } from "@/lib/id";

/**
 * The platform registry — which organizations exist and which email belongs to which one.
 *
 * Used to live in its own Google Spreadsheet (the one thing Pro ERP itself owned, since
 * every organization's actual business data lived in their own connected sheets). Now
 * `organizations` and `users_index` are just tables in the same Neon Postgres database as
 * everything else — no separate "platform sheet" concept survives this rewrite.
 */
export type Organization = InferSelectModel<typeof organizations>;
export type UserIndexEntry = InferSelectModel<typeof usersIndex>;

export async function listOrganizations(): Promise<Organization[]> {
  return db.select().from(organizations);
}

export async function getOrganization(orgId: string): Promise<Organization | null> {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return org ?? null;
}

export async function getOrganizationBySlug(slug: string): Promise<Organization | null> {
  const normalized = slug.trim().toLowerCase();
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, normalized))
    .limit(1);
  return org ?? null;
}

/** Login's first hop: which organization does this email belong to? */
export async function lookupUserOrg(email: string): Promise<UserIndexEntry | null> {
  const normalized = email.trim().toLowerCase();
  const [entry] = await db
    .select()
    .from(usersIndex)
    .where(eq(usersIndex.email, normalized))
    .limit(1);
  return entry ?? null;
}

/**
 * Emails are unique across the whole platform, not just within one org — the login form
 * only asks for an email, so the same address in two organizations would be ambiguous.
 */
export async function isEmailTaken(email: string): Promise<boolean> {
  return (await lookupUserOrg(email)) !== null;
}

export async function indexUser(entry: UserIndexEntry): Promise<void> {
  await db.insert(usersIndex).values({
    email: entry.email.trim().toLowerCase(),
    orgId: entry.orgId,
    userId: entry.userId,
    status: entry.status,
  });
}

/** Keeps the index's Status column in step with the org's own Users table. */
export async function updateIndexedUserStatus(email: string, status: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  await db
    .update(usersIndex)
    .set({ status: status as UserIndexEntry["status"] })
    .where(eq(usersIndex.email, normalized));
}

/**
 * Removes an email from the platform index, freeing it for reuse.
 *
 * Sign-in looks up which organization an email belongs to here, so an entry left behind
 * would keep that address claimed across the whole platform even though the user is gone.
 */
export async function removeIndexedUser(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  await db.delete(usersIndex).where(eq(usersIndex.email, normalized));
}

/**
 * Removes an organization from the registry, along with every row any tenant-scoped table
 * owns for it.
 *
 * Unlike the Sheets era — where an organization's data lived in totally separate
 * spreadsheets that this platform never touched — every domain table is now a shared table
 * with a foreign key back to `organizations`. There is no way to delete the organization
 * row while leaving orphaned rows behind in any of them (Postgres refuses it: this was hit
 * for real during Phase 1 verification — deleting an org with a settings row still present
 * failed with `settings_org_id_organizations_id_fk`), so this deletes every tenant-scoped
 * table's rows along with the registry entries, atomically. This list must cover every
 * table in `src/db/schema/**` that has an `org_id` column referencing `organizations` — a
 * table left out here means deleting an org with any data in it throws a foreign-key
 * violation instead of actually deleting it. None of these tables reference each other (only
 * `organizations`), so they can be deleted in any order within the same batch.
 *
 * Uses `db.batch()`, not `db.transaction()` — the neon-http driver has no interactive
 * transaction support at all (`db.transaction()` throws unconditionally: "No transactions
 * support in neon-http driver"). `batch()` is neon-http's real atomicity primitive: every
 * statement rides one HTTP round trip as a single Neon-side transaction, succeeding or
 * failing together, just without the ability to branch on an earlier statement's result
 * mid-batch. That limitation doesn't matter here — if `orgId` doesn't exist, every delete
 * affects zero rows (a harmless no-op commit); existence is checked up front instead (see
 * below), both to fail fast and because TypeScript's tuple inference for `db.batch()`
 * stops preserving each statement's own result type somewhere around this many mixed
 * statements — indexing into the batch result to recover one delete's `.returning()` rows
 * silently widened to a type with no `.length`, so this reads the row first instead of
 * asking the batch which one deleted it.
 */
export async function deleteOrganization(orgId: string): Promise<void> {
  const existing = await getOrganization(orgId);
  if (!existing) {
    throw new Error("Organization nahi mili.");
  }

  await db.batch([
    db.delete(usersIndex).where(eq(usersIndex.orgId, orgId)),
    db.delete(reportShares).where(eq(reportShares.orgId, orgId)),
    db.delete(settings).where(eq(settings.orgId, orgId)),
    db.delete(tasks).where(eq(tasks.orgId, orgId)),
    db.delete(recurringTasks).where(eq(recurringTasks.orgId, orgId)),
    db.delete(holidayList).where(eq(holidayList.orgId, orgId)),
    db.delete(inwardIqcFms).where(eq(inwardIqcFms.orgId, orgId)),
    db.delete(failureLog).where(eq(failureLog.orgId, orgId)),
    db.delete(imsInward).where(eq(imsInward.orgId, orgId)),
    db.delete(items).where(eq(items.orgId, orgId)),
    db.delete(stockLedger).where(eq(stockLedger.orgId, orgId)),
    db.delete(indents).where(eq(indents.orgId, orgId)),
    db.delete(bom).where(eq(bom.orgId, orgId)),
    db.delete(productionPlans).where(eq(productionPlans.orgId, orgId)),
    db.delete(planMaterials).where(eq(planMaterials.orgId, orgId)),
    db.delete(fmsTemplates).where(eq(fmsTemplates.orgId, orgId)),
    db.delete(fmsRuns).where(eq(fmsRuns.orgId, orgId)),
    db.delete(fmsWeekoffOverrides).where(eq(fmsWeekoffOverrides.orgId, orgId)),
    db.delete(purchaseOrderLines).where(eq(purchaseOrderLines.orgId, orgId)),
    db.delete(purchaseOrders).where(eq(purchaseOrders.orgId, orgId)),
    db.delete(vendorItems).where(eq(vendorItems.orgId, orgId)),
    db.delete(vendors).where(eq(vendors.orgId, orgId)),
    db.delete(customers).where(eq(customers.orgId, orgId)),
    db.delete(leaveReassignments).where(eq(leaveReassignments.orgId, orgId)),
    db.delete(leaveApprovals).where(eq(leaveApprovals.orgId, orgId)),
    db.delete(leaves).where(eq(leaves.orgId, orgId)),
    db.delete(leaveApprovalSteps).where(eq(leaveApprovalSteps.orgId, orgId)),
    db.delete(dispatchActivities).where(eq(dispatchActivities.orgId, orgId)),
    db.delete(dispatches).where(eq(dispatches.orgId, orgId)),
    db.delete(invoices).where(eq(invoices.orgId, orgId)),
    db.delete(tmsActivities).where(eq(tmsActivities.orgId, orgId)),
    db.delete(tmsShipmentItems).where(eq(tmsShipmentItems.orgId, orgId)),
    db.delete(tmsShipments).where(eq(tmsShipments.orgId, orgId)),
    db.delete(transportVendors).where(eq(transportVendors.orgId, orgId)),
    db.delete(pdiActivities).where(eq(pdiActivities.orgId, orgId)),
    db.delete(pdiInspections).where(eq(pdiInspections.orgId, orgId)),
    db.delete(orderActivities).where(eq(orderActivities.orgId, orgId)),
    db.delete(orderPayments).where(eq(orderPayments.orgId, orgId)),
    db.delete(orderItems).where(eq(orderItems.orgId, orgId)),
    db.delete(orders).where(eq(orders.orgId, orgId)),
    db.delete(quotationItems).where(eq(quotationItems.orgId, orgId)),
    db.delete(quotations).where(eq(quotations.orgId, orgId)),
    db.delete(leadActivities).where(eq(leadActivities.orgId, orgId)),
    db.delete(leads).where(eq(leads.orgId, orgId)),
    db.delete(leaveQuotas).where(eq(leaveQuotas.orgId, orgId)),
    db.delete(journalLines).where(eq(journalLines.orgId, orgId)),
    db.delete(journalEntries).where(eq(journalEntries.orgId, orgId)),
    db.delete(chartOfAccounts).where(eq(chartOfAccounts.orgId, orgId)),
    db.delete(billPayments).where(eq(billPayments.orgId, orgId)),
    db.delete(bills).where(eq(bills.orgId, orgId)),
    db.delete(payslips).where(eq(payslips.orgId, orgId)),
    db.delete(payrollRuns).where(eq(payrollRuns.orgId, orgId)),
    db.delete(salaryStructures).where(eq(salaryStructures.orgId, orgId)),
    db.delete(users).where(eq(users.orgId, orgId)),
    db.delete(organizations).where(eq(organizations.id, orgId)),
  ]);
}

interface CreateOrganizationInput {
  orgName: string;
  ownerEmail: string;
}

export async function createOrganization(
  input: CreateOrganizationInput
): Promise<Organization> {
  const orgs = await listOrganizations();

  // Two orgs called "Acme" must not collide on the slug.
  const base = slugify(input.orgName);
  const taken = new Set(orgs.map((o) => o.slug?.trim().toLowerCase()));
  let slug = base;
  let n = 2;
  while (taken.has(slug)) {
    slug = `${base}-${n++}`;
  }

  const [org] = await db
    .insert(organizations)
    .values({
      id: generateId("ORG"),
      orgName: input.orgName.trim(),
      slug,
      ownerEmail: input.ownerEmail.trim().toLowerCase(),
      plan: "Free",
      status: "Active",
    })
    .returning();

  return org;
}

export async function updateOrganization(
  orgId: string,
  patch: Partial<Omit<Organization, "id" | "createdAt">>
): Promise<Organization> {
  const [updated] = await db
    .update(organizations)
    .set(patch)
    .where(eq(organizations.id, orgId))
    .returning();

  if (!updated) {
    throw new Error("Organization nahi mila.");
  }
  return updated;
}
