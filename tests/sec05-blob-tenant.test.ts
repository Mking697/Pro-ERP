import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  getOrganization: vi.fn(),
  uploadAttachmentForOrg: vi.fn(),
}));
vi.mock("next/server", () => ({ NextResponse: { json: Response.json } }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/auth/guard", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/auth/live-session", () => ({ getLiveSessionFromToken: vi.fn() }));
vi.mock("@/lib/platform/registry", () => ({ getOrganization: mocks.getOrganization }));
vi.mock("@/lib/storage", () => ({ uploadAttachmentForOrg: mocks.uploadAttachmentForOrg }));
vi.mock("@/db/client", () => { throw new Error("Database forbidden in SEC-05 tests."); });

import { POST } from "@/app/api/blob/upload/route";

const orgId = "ORG-upload";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireSession.mockResolvedValue({ ok: true, session: { orgId, role: "Staff", access: [] } });
  mocks.getOrganization.mockResolvedValue({ id: orgId, orgName: "Upload test", status: "Active", plan: "Growth", trialEndsAt: null });
  mocks.uploadAttachmentForOrg.mockImplementation(async (resolvedOrgId: string) => ({
    url: `/uploads/orgs/${resolvedOrgId}/test-file.png`,
    target: "local",
  }));
});

function request(fileName = "test-file.png", mimeType = "image/png", bytes = 10) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], fileName, { type: mimeType }));
  return new Request("https://app.example/api/blob/upload", { method: "POST", body: form });
}

describe("SEC-05 live tenant upload admission", () => {
  it.each([null, { id: orgId, orgName: "Expired", status: "Active", plan: "Trial", trialEndsAt: "2000-01-01T00:00:00Z" }])(
    "rejects missing/expired tenants before writing to disk (%j)", async (org) => {
      mocks.getOrganization.mockResolvedValue(org);
      expect((await POST(request())).status).toBe(403);
      expect(mocks.uploadAttachmentForOrg).not.toHaveBeenCalled();
    },
  );

  it.each([
    { plan: "Growth", trialEndsAt: "2000-01-01T00:00:00Z" },
    { plan: "Trial", trialEndsAt: "2999-01-01T00:00:00Z" },
  ])("allows active $plan tenants and writes under their own org", async (plan) => {
    mocks.getOrganization.mockResolvedValue({ id: orgId, orgName: "Active", status: "Active", ...plan });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: `/uploads/orgs/${orgId}/test-file.png` });
    expect(mocks.getOrganization).toHaveBeenCalledExactlyOnceWith(orgId);
    expect(mocks.uploadAttachmentForOrg).toHaveBeenCalledExactlyOnceWith(
      orgId,
      expect.objectContaining({ fileName: "test-file.png" })
    );
  });

  it("preserves the authentication rejection without reading a tenant or writing to disk", async () => {
    const response = Response.json({ error: "Unauthorized." }, { status: 401 });
    mocks.requireSession.mockResolvedValue({ ok: false, response });
    expect(await POST(request())).toBe(response);
    expect(mocks.getOrganization).not.toHaveBeenCalled();
    expect(mocks.uploadAttachmentForOrg).not.toHaveBeenCalled();
  });

  it("fails closed when the registry read fails", async () => {
    mocks.getOrganization.mockRejectedValue(new Error("Registry unavailable"));
    await expect(POST(request())).rejects.toThrow("Registry unavailable");
    expect(mocks.uploadAttachmentForOrg).not.toHaveBeenCalled();
  });

  it("reads live status on each authorization after suspension", async () => {
    expect((await POST(request())).status).toBe(200);
    mocks.uploadAttachmentForOrg.mockClear();
    mocks.getOrganization.mockResolvedValue({ id: orgId, orgName: "Now suspended", status: "Suspended", plan: "Growth", trialEndsAt: null });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.getOrganization).toHaveBeenCalledTimes(2);
    expect(mocks.uploadAttachmentForOrg).not.toHaveBeenCalled();
  });

  it.each([
    ["test.svg", "image/svg+xml"],
    ["test.html", "text/html"],
    ["test.exe", "application/octet-stream"],
  ])("retains MIME restrictions (%s, %s)", async (fileName, mime) => {
    expect((await POST(request(fileName, mime))).status).toBe(400);
    expect(mocks.getOrganization).toHaveBeenCalledExactlyOnceWith(orgId);
    expect(mocks.uploadAttachmentForOrg).not.toHaveBeenCalled();
  });

  it("rejects a file over the size cap without writing to disk", async () => {
    expect((await POST(request("big.png", "image/png", 101 * 1024 * 1024))).status).toBe(400);
    expect(mocks.uploadAttachmentForOrg).not.toHaveBeenCalled();
  });

  it("ignores an ambient tenant context and resolves the live session's own org", async () => {
    const { runWithTenant } = await import("@/lib/tenant");
    const response = await runWithTenant({ orgId: "ORG-foreign", org: {} as never }, () => POST(request()));
    expect(response.status).toBe(200);
    expect(mocks.getOrganization).toHaveBeenCalledExactlyOnceWith(orgId);
    expect(mocks.uploadAttachmentForOrg).toHaveBeenCalledExactlyOnceWith(orgId, expect.anything());
  });

  it("rejects a valid user in a suspended organization before writing to disk", async () => {
    mocks.getOrganization.mockResolvedValue({ id: orgId, orgName: "Suspended", status: "Suspended", plan: "Growth", trialEndsAt: null });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.getOrganization).toHaveBeenCalledExactlyOnceWith(orgId);
    expect(mocks.uploadAttachmentForOrg).not.toHaveBeenCalled();
  });
});
