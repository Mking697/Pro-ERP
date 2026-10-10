import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import type { Organization } from "@/lib/platform/registry";

const mocks = vi.hoisted(() => ({
  verifySession: vi.fn(),
  cookies: vi.fn(),
  liveUser: vi.fn(),
  getOrganization: vi.fn(),
  getAllSettings: vi.fn(),
  getSetting: vi.fn(),
  getMySession: vi.fn(),
  createChatSession: vi.fn(),
  appendMessage: vi.fn(),
  recentSessionMessages: vi.fn(),
  recordChatAudit: vi.fn(),
  checkRateLimit: vi.fn(),
  callGemini: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/auth/session", () => ({
  SESSION_COOKIE: "erp_session",
  verifySession: mocks.verifySession,
}));
vi.mock("@/db/client", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.liveUser }) }) }) },
}));
vi.mock("@/lib/platform/registry", () => ({ getOrganization: mocks.getOrganization }));
vi.mock("@/lib/settings", () => ({
  getAllSettings: mocks.getAllSettings,
  getSetting: mocks.getSetting,
}));
vi.mock("@/lib/chatbot/sessions", () => ({
  getMySession: mocks.getMySession,
  createChatSession: mocks.createChatSession,
  appendMessage: mocks.appendMessage,
  recentSessionMessages: mocks.recentSessionMessages,
}));
vi.mock("@/lib/chatbot/audit", () => ({ recordChatAudit: mocks.recordChatAudit }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/chatbot/tools", () => ({ getAvailableTools: () => [], findTool: () => null }));
vi.mock("@/lib/errorLog", () => ({ logError: vi.fn() }));
vi.mock("@/lib/chatbot/gemini", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/chatbot/gemini")>(),
  callGemini: mocks.callGemini,
}));

import { POST } from "@/app/api/chatbot/message/route";
import { getTenant } from "@/lib/tenant";

const session: SessionPayload = {
  orgId: "ORG-chat-test", userId: "USR-chat-test", email: "chat@example.com",
  fullName: "Chat User", role: "Staff", access: ["AI_CHATBOT"], tokenVersion: 2,
};
const org = {
  id: session.orgId, orgName: "Chat Test", status: "Active", plan: "Growth",
} as Organization;
const settings: Record<string, string> = {
  GEMINI_API_KEY: "test-only-placeholder", CHATBOT_DAILY_MESSAGE_CAP: "37",
};

function request(message = "hi", sessionId: string | undefined = "CHAT-existing") {
  return new Request("http://localhost/api/chatbot/message", {
    method: "POST", body: JSON.stringify({ message, sessionId }),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.cookies.mockResolvedValue({ get: () => ({ value: "test-cookie" }) });
  mocks.verifySession.mockResolvedValue(session);
  mocks.liveUser.mockResolvedValue([{ status: "Active", tokenVersion: 2 }]);
  mocks.getOrganization.mockResolvedValue(org);
  mocks.getAllSettings.mockResolvedValue(settings);
  mocks.getSetting.mockImplementation(async (key: string) => settings[key] ?? null);
  mocks.getMySession.mockResolvedValue({ id: "CHAT-existing" });
  mocks.createChatSession.mockResolvedValue({ id: "CHAT-new" });
  mocks.recentSessionMessages.mockResolvedValue([]);
  mocks.checkRateLimit.mockResolvedValue({ allowed: true });
  mocks.callGemini.mockResolvedValue({ text: "Ungrounded answer", functionCalls: [] });
});

describe("chatbot request-scoped tenant reuse", () => {
  it("keeps the resolved tenant active during session lookup, persistence and audit", async () => {
    const tenants: string[] = [];
    const capture = async () => { tenants.push((await getTenant()).orgId); };
    mocks.getMySession.mockImplementation(async () => {
      await capture();
      return { id: "CHAT-existing" };
    });
    mocks.appendMessage.mockImplementation(capture);
    mocks.recordChatAudit.mockImplementation(capture);
    await POST(request());
    expect(tenants).toEqual([org.id, org.id, org.id, org.id]);
    expect(mocks.getOrganization).toHaveBeenCalledTimes(1);
  });

  it("creates a new chat inside the same validated tenant context", async () => {
    mocks.createChatSession.mockImplementation(async () => {
      expect((await getTenant()).org).toBe(org);
      return { id: "CHAT-new" };
    });
    const response = await POST(request("hi", ""));
    expect((await response.json()).sessionId).toBe("CHAT-new");
    expect(mocks.getMySession).not.toHaveBeenCalled();
    expect(mocks.getOrganization).toHaveBeenCalledTimes(1);
  });

  it("does not mix tenant names or rate-limit keys between concurrent requests", async () => {
    const otherSession = { ...session, orgId: "ORG-other", userId: "USR-other" };
    const otherOrg = { ...org, id: otherSession.orgId, orgName: "Other Organization" };
    mocks.verifySession.mockResolvedValueOnce(session).mockResolvedValueOnce(otherSession);
    mocks.getOrganization.mockImplementation(async (id: string) => id === org.id ? org : otherOrg);
    mocks.getAllSettings.mockImplementation(async () => {
      const before = await getTenant();
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect((await getTenant()).orgId).toBe(before.orgId);
      return settings;
    });
    const responses = await Promise.all([
      POST(request("Question A")), POST(request("Question B")),
    ]);
    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(mocks.getOrganization).toHaveBeenCalledTimes(2);
    expect(mocks.verifySession).toHaveBeenCalledTimes(2);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("chatbot-daily", org.id, 37, 86_400);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("chatbot-daily", otherOrg.id, 37, 86_400);
    const prompts = mocks.callGemini.mock.calls.map((call) => call[1]);
    expect(prompts.some((prompt) => prompt.includes('organization "Chat Test"'))).toBe(true);
    expect(prompts.some((prompt) => prompt.includes('organization "Other Organization"'))).toBe(true);
  });

  it.each([null, { ...session, access: [] }])("rejects missing session or missing module grant", async (payload) => {
    mocks.verifySession.mockResolvedValue(payload);
    const response = await POST(request());
    expect(response.status).toBe(payload ? 403 : 401);
    expect(mocks.getMySession).not.toHaveBeenCalled();
    expect(mocks.getAllSettings).not.toHaveBeenCalled();
  });

  it.each([
    { ...org, status: "Suspended" },
    { ...org, plan: "Trial", trialEndsAt: new Date("2020-01-01") },
    null,
  ])("rejects suspended, expired or missing organizations", async (organization) => {
    mocks.getOrganization.mockResolvedValue(organization);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.getAllSettings).not.toHaveBeenCalled();
  });

  it("still rejects revoked sessions before reading the organization", async () => {
    mocks.liveUser.mockResolvedValue([{ status: "Active", tokenVersion: 3 }]);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.getOrganization).not.toHaveBeenCalled();
  });

  it("keeps chat ownership rejection before settings and message writes", async () => {
    mocks.getMySession.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(404);
    expect(mocks.getAllSettings).not.toHaveBeenCalled();
    expect(mocks.appendMessage).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only key as disconnected without spending rate limit", async () => {
    mocks.getAllSettings.mockResolvedValue({ GEMINI_API_KEY: "  " });
    const response = await POST(request());
    expect((await response.json()).status).toBe("not_connected");
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.appendMessage).not.toHaveBeenCalled();
  });

  it.each([undefined, "invalid", "0", "-1"])("preserves the default cap for %s", async (cap) => {
    mocks.getAllSettings.mockResolvedValue({ GEMINI_API_KEY: "test-only-placeholder", CHATBOT_DAILY_MESSAGE_CAP: cap });
    await POST(request());
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("chatbot-daily", org.id, 200, 86_400);
  });

  it("preserves rate-limit responses without persisting or calling Gemini", async () => {
    mocks.checkRateLimit.mockResolvedValue({ allowed: false, retryAfterSeconds: 123 });
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect((await response.json()).retryAfterSeconds).toBe(123);
    expect(mocks.appendMessage).not.toHaveBeenCalled();
    expect(mocks.callGemini).not.toHaveBeenCalled();
  });

  it("still discards an ungrounded model answer", async () => {
    const response = await POST(request("Question"));
    const body = await response.json();
    expect(body.reply).toContain("I can only answer questions about your own Pro ERP data");
    expect(body.groundedInTool).toBe(false);
    expect(mocks.appendMessage).toHaveBeenCalledTimes(2);
    expect(mocks.recordChatAudit).toHaveBeenCalledTimes(1);
  });

  it("reads settings once for both the trimmed key and daily cap", async () => {
    mocks.getAllSettings.mockResolvedValue({ ...settings, GEMINI_API_KEY: "  test-only-placeholder  " });
    const response = await POST(request("What can you tell me?"));
    expect(response.status).toBe(200);
    expect(mocks.getAllSettings).toHaveBeenCalledTimes(1);
    expect(mocks.getSetting).not.toHaveBeenCalled();
    expect(mocks.checkRateLimit).toHaveBeenCalledWith("chatbot-daily", org.id, 37, 86_400);
    expect(mocks.callGemini.mock.calls[0][0]).toBe("test-only-placeholder");
  });
  it("uses the guard-resolved organization name without fetching it again for Gemini", async () => {
    await POST(request("What can you tell me?"));
    expect(mocks.callGemini.mock.calls[0][1]).toContain('organization "Chat Test"');
    expect(mocks.getOrganization).toHaveBeenCalledTimes(1);
  });

  it("resolves the organization and verifies the cookie only once for an existing chat", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("answered");
    expect(mocks.liveUser).toHaveBeenCalledTimes(1);
    expect(mocks.getOrganization).toHaveBeenCalledTimes(1);
    expect(mocks.verifySession).toHaveBeenCalledTimes(1);
  });
});
