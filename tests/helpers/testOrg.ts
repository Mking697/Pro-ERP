import { createOrganization, type Organization } from "@/lib/platform/registry";

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
