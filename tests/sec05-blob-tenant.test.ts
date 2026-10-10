import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), getOrganization: vi.fn(), handleUpload: vi.fn() }));
vi.mock("next/server", () => ({ NextResponse: { json: Response.json } }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/auth/guard", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/auth/live-session", () => ({ getLiveSessionFromToken: vi.fn() }));
vi.mock("@/lib/platform/registry", () => ({ getOrganization: mocks.getOrganization }));
vi.mock("@vercel/blob/client", () => ({ handleUpload: mocks.handleUpload }));
vi.mock("@/db/client", () => { throw new Error("Database forbidden in SEC-05 tests."); });

import { POST } from "@/app/api/blob/upload/route";

const orgId = "ORG-upload";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireSession.mockResolvedValue({ ok: true, session: { orgId, role: "Staff", access: [] } });
  mocks.getOrganization.mockResolvedValue({ id: orgId, orgName: "Upload test", status: "Active", plan: "Growth", trialEndsAt: null });
  mocks.handleUpload.mockImplementation(async (options: {
    body: { pathname: string; clientPayload: string };
    onBeforeGenerateToken: (pathname: string, payload: string) => Promise<unknown>;
  }) => ({
    token: "mock-upload-token",
    policy: await options.onBeforeGenerateToken(options.body.pathname, options.body.clientPayload),
  }));
});

function request(pathname = `attachments/${orgId}/test-file.png`, clientPayload = "image/png") {
  return new Request("https://app.example/api/blob/upload", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "blob.generate-client-token", pathname, clientPayload }),
  });
}

describe("SEC-05 live tenant upload admission", () => {
  it.each([null, { id: orgId, orgName: "Expired", status: "Active", plan: "Trial", trialEndsAt: "2000-01-01T00:00:00Z" }])(
    "rejects missing/expired tenants before Blob access (%j)", async (org) => {
      mocks.getOrganization.mockResolvedValue(org);
      expect((await POST(request())).status).toBe(403);
      expect(mocks.handleUpload).not.toHaveBeenCalled();
    },
  );

  it.each([
    { plan: "Growth", trialEndsAt: "2000-01-01T00:00:00Z" },
    { plan: "Trial", trialEndsAt: "2999-01-01T00:00:00Z" },
  ])("allows active $plan tenants with existing scoped upload policy", async (plan) => {
    mocks.getOrganization.mockResolvedValue({ id: orgId, orgName: "Active", status: "Active", ...plan });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ token: "mock-upload-token", policy: {
      allowedContentTypes: ["image/png"], maximumSizeInBytes: 100 * 1024 * 1024,
      addRandomSuffix: false, allowOverwrite: false,
    } });
    expect(mocks.getOrganization).toHaveBeenCalledExactlyOnceWith(orgId);
  });

  it("preserves the authentication rejection without reading a tenant or invoking Blob", async () => {
    const response = Response.json({ error: "Unauthorized." }, { status: 401 });
    mocks.requireSession.mockResolvedValue({ ok: false, response });
    expect(await POST(request())).toBe(response);
    expect(mocks.getOrganization).not.toHaveBeenCalled();
    expect(mocks.handleUpload).not.toHaveBeenCalled();
  });

  it("fails closed when the registry read fails", async () => {
    mocks.getOrganization.mockRejectedValue(new Error("Registry unavailable"));
    await expect(POST(request())).rejects.toThrow("Registry unavailable");
    expect(mocks.handleUpload).not.toHaveBeenCalled();
  });

  it("reads live status on each authorization after suspension", async () => {
    expect((await POST(request())).status).toBe(200);
    mocks.handleUpload.mockClear();
    mocks.getOrganization.mockResolvedValue({ id: orgId, orgName: "Now suspended", status: "Suspended", plan: "Growth", trialEndsAt: null });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.getOrganization).toHaveBeenCalledTimes(2);
    expect(mocks.handleUpload).not.toHaveBeenCalled();
  });

  it.each([
    [`attachments/ORG-foreign/test.png`, "image/png"],
    [`orgs/${orgId}/logo.png`, "image/png"],
    [`attachments/${orgId}/../test.png`, "image/png"],
    [`attachments/${orgId}/test.svg`, "image/svg+xml"],
    [`attachments/${orgId}/test.html`, "text/html"],
  ])("retains pathname/MIME restrictions (%s, %s)", async (pathname, mime) => {
    expect((await POST(request(pathname, mime))).status).toBe(400);
    expect(mocks.getOrganization).toHaveBeenCalledExactlyOnceWith(orgId);
  });

  it("ignores an ambient tenant context and resolves the live session's own org", async () => {
    const { runWithTenant } = await import("@/lib/tenant");
    const response = await runWithTenant({ orgId: "ORG-foreign", org: {} as never }, () => POST(request()));
    expect(response.status).toBe(200);
    expect(mocks.getOrganization).toHaveBeenCalledExactlyOnceWith(orgId);
  });

  it("rejects a valid user in a suspended organization before invoking Blob", async () => {
    mocks.getOrganization.mockResolvedValue({ id: orgId, orgName: "Suspended", status: "Suspended", plan: "Growth", trialEndsAt: null });
    expect((await POST(request())).status).toBe(403);
    expect(mocks.getOrganization).toHaveBeenCalledExactlyOnceWith(orgId);
    expect(mocks.handleUpload).not.toHaveBeenCalled();
  });
});
