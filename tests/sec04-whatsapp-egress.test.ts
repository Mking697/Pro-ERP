import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSetting: vi.fn(), upsertSetting: vi.fn(), requireRole: vi.fn(),
  fetch: vi.fn(), logError: vi.fn(),
}));
vi.mock("next/server", () => ({ NextResponse: { json: Response.json } }));
vi.mock("@/lib/auth/guard", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/settings", () => ({ getSetting: mocks.getSetting, upsertSetting: mocks.upsertSetting }));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "ORG-egress" }));
vi.mock("@/lib/errorLog", () => ({ logError: mocks.logError }));
vi.mock("@/db/client", () => { throw new Error("Database forbidden in SEC-04 tests."); });

import { POST } from "@/app/api/admin/settings/whatsapp/route";
import { sendWhatsAppMessage } from "@/lib/chatxflow";

let baseUrl = "https://chatxflow.online";
beforeEach(() => {
  vi.resetAllMocks();
  baseUrl = "https://chatxflow.online";
  mocks.requireRole.mockResolvedValue({ ok: true });
  mocks.getSetting.mockImplementation(async (key: string) => key === "CHATXFLOW_BASE_URL" ? baseUrl : "test-token");
  mocks.fetch.mockResolvedValue(Response.json({ success: true }));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());

function request(value: string) {
  return new Request("https://app.example/api/admin/settings/whatsapp", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseUrl: value }),
  });
}

describe("SEC-04 provider-only egress", () => {
  it.each([
    "https://[::ffff:127.0.0.1]", "https://[::ffff:7f00:1]", "https://[fe80::1]",
    "https://[febf::1]", "https://[fc00::1]", "https://[fd00::1]", "https://[::1]",
    "https://127.0.0.1", "https://2130706433", "https://0x7f000001", "https://0177.0.0.1",
    "https://169.254.169.254", "https://10.0.0.1", "https://192.168.1.1", "https://172.16.1.1",
    "https://localhost", "https://private-dns.example", "https://anything.local", "https://anything.internal",
    "https://sub.chatxflow.online", "https://chatxflow.online.evil.example", "https://chatxflow.online.",
    "https://user:password@chatxflow.online", "https://chatxflow.online@evil.example",
    "http://chatxflow.online", "https://chatxflow.online:8443", "https://chatxflow.online/custom",
    "https://chatxflow.online?target=internal", "https://chatxflow.online#fragment", "not-a-url",
  ])("rejects %s at save time and send time without any egress", async (value) => {
    baseUrl = value;
    expect((await POST(request(value))).status).toBe(400);
    expect(mocks.upsertSetting).not.toHaveBeenCalled();
    expect((await sendWhatsAppMessage("9876543210", "message")).ok).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(["", "   ", "https://chatxflow.online", " HTTPS://CHATXFLOW.ONLINE:443/ "])(
    "preserves approved provider workflow for %s", async (value) => {
      baseUrl = value;
      expect((await POST(request(value))).status).toBe(200);
      expect((await sendWhatsAppMessage("9876543210", "message"))).toEqual({ ok: true });
      expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith("https://chatxflow.online/api/v1/send", expect.objectContaining({
        method: "POST", redirect: "error", body: JSON.stringify({ phone: "919876543210", message: "message" }),
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      }));
    },
  );

  it("persists the canonical approved origin and preserves an existing token", async () => {
    expect((await POST(request(" HTTPS://CHATXFLOW.ONLINE:443/ "))).status).toBe(200);
    expect(mocks.upsertSetting).toHaveBeenCalledWith("CHATXFLOW_BASE_URL", "https://chatxflow.online");
    expect(mocks.upsertSetting).not.toHaveBeenCalledWith("CHATXFLOW_API_TOKEN", expect.anything());
  });

  it("refuses an unsafe redirect without forwarding the token or message", async () => {
    const destinations: string[] = [];
    mocks.fetch.mockImplementation(async (url: string, init: RequestInit) => {
      destinations.push(url);
      // Model fetch's redirect contract, without any real transport.
      if (init.redirect === "error") throw new TypeError("fetch failed: redirect forbidden");
      destinations.push("https://[::ffff:127.0.0.1]/internal");
      return Response.json({ success: true });
    });
    expect((await sendWhatsAppMessage("9876543210", "message")).ok).toBe(false);
    expect(destinations).toEqual(["https://chatxflow.online/api/v1/send"]);
  });

  it("rejects custom DNS destinations before settings writes or outbound calls", async () => {
    baseUrl = "https://custom-provider.example";
    expect((await POST(request(baseUrl))).status).toBe(400);
    expect(mocks.upsertSetting).not.toHaveBeenCalled();
    expect((await sendWhatsAppMessage("9876543210", "message")).ok).toBe(false);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
