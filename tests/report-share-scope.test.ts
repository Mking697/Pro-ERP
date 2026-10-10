import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import type { ReportShare } from "@/lib/platform/shares";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  listReportShares: vi.fn(),
  createReportShare: vi.fn(),
  revokeReportShare: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: Response.json } }));
vi.mock("@/lib/auth/guard", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/platform/shares", () => ({
  listReportShares: mocks.listReportShares,
  createReportShare: mocks.createReportShare,
  revokeReportShare: mocks.revokeReportShare,
}));
// Fail closed if an unexpected import ever reaches the real DB boundary.
vi.mock("@/db/client", () => {
  throw new Error("Live database access is forbidden in share-scope tests.");
});

import { DELETE, GET, POST } from "@/app/api/reports/shares/route";

const session: SessionPayload = {
  orgId: "ORG-share-test", userId: "USR-share-test", email: "staff@example.com",
  fullName: "Share User", role: "Staff", access: ["INWARD_ENTRY"], tokenVersion: 1,
};

function share(report: string, token = `token-${report}`): ReportShare {
  return {
    Token: token, Org_ID: session.orgId, Report: report, Label: "Team report",
    Range_Key: "month", From_Date: "", To_Date: "", Access: "INWARD_ENTRY",
    Created_By: "admin@example.com", Created_At: "2026-01-01T00:00:00.000Z",
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireSession.mockResolvedValue({ ok: true, session: { ...session, access: [...session.access] } });
  mocks.listReportShares.mockResolvedValue([share("inward"), share("leave")]);
});

function asViewer(role: string, access: string[]) {
  mocks.requireSession.mockResolvedValue({ ok: true, session: { ...session, role, access } });
}

function createRequest(report: string) {
  return new Request("http://localhost/api/reports/shares", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ report, label: "Team report", rangeKey: "month" }),
  });
}

describe("report-share token listing scope", () => {
  it.each(["", "?report=inward", "?report=leave"])(
    "returns no public credentials to a mine-only reader (%s)", async (query) => {
      const response = await GET(new Request(`http://localhost/api/reports/shares${query}`));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ shares: [] });
      expect(mocks.listReportShares).not.toHaveBeenCalled();
    },
  );

  it("does not disclose a previously-created token after its owner loses everyone scope", async () => {
    mocks.listReportShares.mockResolvedValue([{ ...share("inward"), Created_By: session.email }]);
    const response = await GET(new Request("http://localhost/api/reports/shares?report=inward"));
    expect(await response.json()).toEqual({ shares: [] });
    expect(mocks.listReportShares).not.toHaveBeenCalled();
  });

  it.each([
    { role: "Admin", access: ["INWARD_ENTRY"] },
    { role: "Staff", access: ["PERFORMANCE_VIEW", "INWARD_ENTRY"] },
  ])("lists permitted organization links for $role with $access", async ({ role, access }) => {
    asViewer(role, access);
    mocks.listReportShares.mockResolvedValue([share("inward"), share("ppc"), share("unknown"), share("leave")]);
    const response = await GET(new Request("http://localhost/api/reports/shares"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ shares: [
      { token: "token-inward", report: "inward", label: "Team report", rangeKey: "month",
        createdBy: "admin@example.com", createdAt: "2026-01-01T00:00:00.000Z" },
      { token: "token-leave", report: "leave", label: "Team report", rangeKey: "month",
        createdBy: "admin@example.com", createdAt: "2026-01-01T00:00:00.000Z" },
    ] });
    expect(mocks.listReportShares).toHaveBeenCalledExactlyOnceWith(session.orgId);
  });

  it.each([
    { role: "Admin", access: [] },
    { role: "Staff", access: ["PERFORMANCE_VIEW"] },
  ])("does not let $role everyone scope bypass inward module access", async ({ role, access }) => {
    asViewer(role, access);
    const response = await GET(new Request("http://localhost/api/reports/shares?report=inward"));
    expect(await response.json()).toEqual({ shares: [] });
  });

  it.each(["?report=inward", "?report=unknown", "?report=ppc"])(
    "retains explicit report filtering (%s)", async (query) => {
      asViewer("Staff", ["PERFORMANCE_VIEW", "INWARD_ENTRY"]);
      mocks.listReportShares.mockResolvedValue([share("inward"), share("leave"), share("unknown"), share("ppc")]);
      const response = await GET(new Request(`http://localhost/api/reports/shares${query}`));
      const body = await response.json();
      expect(body.shares.map((s: { report: string }) => s.report)).toEqual(
        query === "?report=inward" ? ["inward"] : [],
      );
    },
  );

  it("selects the session tenant rather than a caller-supplied organization", async () => {
    asViewer("Admin", ["INWARD_ENTRY"]);
    const foreign = { ...share("inward", "foreign-token"), Org_ID: "ORG-other" };
    const records = [share("inward"), foreign];
    // Model the library's tenant-filtered DB contract, without making a DB call.
    mocks.listReportShares.mockImplementation(async (orgId: string) => records.filter((s) => s.Org_ID === orgId));
    const response = await GET(new Request("http://localhost/api/reports/shares?orgId=ORG-other"));
    expect(mocks.listReportShares).toHaveBeenCalledExactlyOnceWith(session.orgId);
    expect((await response.json()).shares.map((s: { token: string }) => s.token)).toEqual(["token-inward"]);
  });

  it.each([GET, POST, DELETE])("preserves the authentication rejection before any share access", async (handler) => {
    const rejected = Response.json({ error: "Unauthorized" }, { status: 401 });
    mocks.requireSession.mockResolvedValue({ ok: false, response: rejected });
    expect(await handler(new Request("http://localhost/api/reports/shares"))).toBe(rejected);
    expect(mocks.listReportShares).not.toHaveBeenCalled();
    expect(mocks.createReportShare).not.toHaveBeenCalled();
    expect(mocks.revokeReportShare).not.toHaveBeenCalled();
  });
});

describe("share creation restrictions remain unchanged", () => {
  it("refuses creation by a mine-only reader who can open the report", async () => {
    expect((await POST(createRequest("inward"))).status).toBe(403);
    expect(mocks.createReportShare).not.toHaveBeenCalled();
  });

  it.each(["unknown", "tasks", "payroll", "delegation"])("refuses unknown or personal report %s", async (report) => {
    asViewer("Admin", ["INWARD_ENTRY", "TASK_DELEGATE"]);
    expect((await POST(createRequest(report))).status).toBe(400);
    expect(mocks.createReportShare).not.toHaveBeenCalled();
  });

  it.each(["Admin", "Staff"])("still requires report module grants for %s creation", async (role) => {
    asViewer(role, ["PERFORMANCE_VIEW"]);
    expect((await POST(createRequest("inward"))).status).toBe(403);
    expect(mocks.createReportShare).not.toHaveBeenCalled();
  });

  it.each(["Admin", "Staff"])("allows entitled %s creation with the session tenant and grants", async (role) => {
    const access = ["PERFORMANCE_VIEW", "INWARD_ENTRY"];
    asViewer(role, access);
    mocks.createReportShare.mockResolvedValue(share("inward"));
    const response = await POST(createRequest("inward"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ token: "token-inward", label: "Team report" });
    expect(mocks.createReportShare).toHaveBeenCalledExactlyOnceWith({
      orgId: session.orgId, report: "inward", label: "Team report", rangeKey: "month",
      from: undefined, to: undefined, access, createdBy: session.email,
    });
  });
});

describe("revocation is separate from permission to read a public credential", () => {
  function revokeRequest(token = "token-inward") {
    return new Request(`http://localhost/api/reports/shares?token=${token}`, { method: "DELETE" });
  }

  it("still lets the creator revoke a known token after losing everyone scope", async () => {
    mocks.listReportShares.mockResolvedValue([{ ...share("inward"), Created_By: session.email }]);
    expect((await DELETE(revokeRequest())).status).toBe(200);
    expect(mocks.revokeReportShare).toHaveBeenCalledExactlyOnceWith(session.orgId, "token-inward");
  });

  it("still lets an Admin revoke another creator's token without report grants", async () => {
    asViewer("Admin", []);
    expect((await DELETE(revokeRequest())).status).toBe(200);
    expect(mocks.revokeReportShare).toHaveBeenCalledExactlyOnceWith(session.orgId, "token-inward");
  });

  it("does not grant team-performance readers permission to revoke colleagues' links", async () => {
    asViewer("Staff", ["PERFORMANCE_VIEW", "INWARD_ENTRY"]);
    expect((await DELETE(revokeRequest())).status).toBe(403);
    expect(mocks.revokeReportShare).not.toHaveBeenCalled();
  });

  it("keeps unknown/foreign-token revocation scoped to the caller's tenant", async () => {
    mocks.listReportShares.mockResolvedValue([]);
    expect((await DELETE(revokeRequest("foreign-token"))).status).toBe(200);
    expect(mocks.listReportShares).toHaveBeenCalledExactlyOnceWith(session.orgId);
    expect(mocks.revokeReportShare).toHaveBeenCalledExactlyOnceWith(session.orgId, "foreign-token");
  });
});
