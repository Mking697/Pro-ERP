import { afterEach, describe, expect, it, vi } from "vitest";

const createOrganization = vi.fn();
const deleteOrganization = vi.fn();

vi.mock("@/lib/platform/registry", () => ({
  createOrganization: (...args: unknown[]) => createOrganization(...args),
  deleteOrganization: (...args: unknown[]) => deleteOrganization(...args),
}));

import { makeTestOrgs, cleanupTestOrgs, filterOwnResults } from "./testOrg";

afterEach(() => {
  createOrganization.mockReset();
  deleteOrganization.mockReset();
});

describe("makeTestOrgs", () => {
  it("preserves creation and cleanup causes when partial setup rollback also fails", async () => {
    const setupError = new Error("creation failed");
    const cleanupError = new Error("rollback failed");
    createOrganization.mockResolvedValueOnce({ id: "org-a" }).mockRejectedValueOnce(setupError);
    deleteOrganization.mockRejectedValueOnce(cleanupError);
    const failure = await makeTestOrgs(["A", "B"]).catch((error) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors).toContain(setupError);
    expect(failure.errors).toContain(cleanupError);
    expect(deleteOrganization).toHaveBeenCalledWith("org-a");
  });
  it("rolls back already-created orgs and throws loudly when a later creation fails", async () => {
    createOrganization
      .mockResolvedValueOnce({ id: "org-a", orgName: "Test A" })
      .mockResolvedValueOnce({ id: "org-b", orgName: "Test B" })
      .mockRejectedValueOnce(new Error("registry unavailable"));
    deleteOrganization.mockResolvedValue(undefined);

    const failure: AggregateError = await makeTestOrgs(["A", "B", "C"]).catch((e) => e);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors.some((e: Error) => /registry unavailable/.test(e.message))).toBe(true);

    // The two that did succeed must not be leaked as orphans.
    expect(deleteOrganization).toHaveBeenCalledWith("org-a");
    expect(deleteOrganization).toHaveBeenCalledWith("org-b");
  });

  it("returns all created orgs when every creation succeeds", async () => {
    createOrganization
      .mockResolvedValueOnce({ id: "org-a", orgName: "Test A" })
      .mockResolvedValueOnce({ id: "org-b", orgName: "Test B" });

    const orgs = await makeTestOrgs(["A", "B"]);

    expect(orgs.map((o) => o.id)).toEqual(["org-a", "org-b"]);
    expect(deleteOrganization).not.toHaveBeenCalled();
  });
});

describe("cleanupTestOrgs", () => {
  it("surfaces a delete failure loudly instead of swallowing it", async () => {
    deleteOrganization
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("delete failed"));

    const failure: AggregateError = await cleanupTestOrgs([
      { id: "org-a", orgName: "Test A" } as never,
      { id: "org-b", orgName: "Test B" } as never,
    ]).catch((e) => e);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.errors.some((e: Error) => /delete failed/.test(e.message))).toBe(true);
    expect(failure.message).toContain("org-b");
  });

  it("does not throw when every delete succeeds", async () => {
    deleteOrganization.mockResolvedValue(undefined);

    await expect(
      cleanupTestOrgs([{ id: "org-a", orgName: "Test A" } as never]),
    ).resolves.not.toThrow();
  });
});

describe("filterOwnResults", () => {
  it("never includes a foreign-tenant sentinel fixture that isn't one of the test's own orgs", () => {
    const own = [{ id: "org-a", orgName: "Test A" } as never, { id: "org-b", orgName: "Test B" } as never];
    const results = [
      { orgId: "org-a", ok: true },
      { orgId: "org-b", ok: true },
      { orgId: "sentinel-foreign-org", ok: true },
    ];

    const scoped = filterOwnResults(results, own);

    expect(scoped).toHaveLength(2);
    expect(scoped.some((r) => r.orgId === "sentinel-foreign-org")).toBe(false);
  });
});
