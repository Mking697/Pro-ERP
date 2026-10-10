import { createOrganization, deleteOrganization, type Organization } from "@/lib/platform/registry";

/**
 * One throwaway org per test, timestamped so parallel/repeated CI runs never collide on
 * the slug or the owner email — same convention as scripts/fms-live-test.ts.
 */
export async function makeTestOrg(label: string): Promise<Organization> {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return createOrganization({
    orgName: `Test ${label} ${stamp}`,
    ownerEmail: `test-${label.toLowerCase()}-${stamp}@example.com`,
  });
}

/**
 * Creates several test orgs, tracking each one as it resolves. Unlike
 * `Promise.all(labels.map(makeTestOrg))`, which discards the references to any orgs that
 * already succeeded the moment a later one in the batch rejects, this rolls back (deletes)
 * every org that did get created before re-throwing — so a partial setup failure never
 * leaves an orphan org invisible to its own test's afterAll/finally.
 */
export async function makeTestOrgs(labels: string[]): Promise<Organization[]> {
  const outcomes = await Promise.allSettled(labels.map((label) => makeTestOrg(label)));
  const created = outcomes
    .filter((o): o is PromiseFulfilledResult<Organization> => o.status === "fulfilled")
    .map((o) => o.value);
  const failures = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");

  if (failures.length > 0) {
    // Retain setup causes even when rollback itself fails.
    const causes: unknown[] = failures.map((f) => f.reason);
    try {
      await cleanupTestOrgs(created);
    } catch (error) {
      causes.push(...(error instanceof AggregateError ? error.errors : [error]));
    }
    throw new AggregateError(
      causes,
      `makeTestOrgs: ${failures.length}/${labels.length} test org creation(s) failed`,
    );
  }

  return created;
}

/**
 * Deletes the given test orgs and throws loudly if any deletion fails, instead of the
 * common `.catch(() => {})` pattern that silently swallows cleanup errors and leaves an
 * orphan org nobody is told about.
 */
export async function cleanupTestOrgs(orgs: Organization[]): Promise<void> {
  const outcomes = await Promise.allSettled(orgs.map((o) => deleteOrganization(o.id)));
  const failures = outcomes
    .map((outcome, index) => ({ outcome, org: orgs[index] }))
    .filter((entry): entry is { outcome: PromiseRejectedResult; org: Organization } =>
      entry.outcome.status === "rejected",
    );

  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((f) => f.outcome.reason),
      `cleanupTestOrgs: failed to delete ${failures.length}/${orgs.length} test org(s): ` +
        failures.map((f) => f.org.id).join(", "),
    );
  }
}

/**
 * Scopes a batch of per-organization results (e.g. from forEachActiveOrganization, which
 * enumerates every active org, not just a test's own fixtures) down to only the orgs this
 * test created — so unrelated organizations already on a shared database never leak into
 * this test's own assertions.
 */
export function filterOwnResults<T extends { orgId: string }>(
  results: T[],
  ownOrgs: Pick<Organization, "id">[],
): T[] {
  const ownIds = new Set(ownOrgs.map((o) => o.id));
  return results.filter((r) => ownIds.has(r.orgId));
}
