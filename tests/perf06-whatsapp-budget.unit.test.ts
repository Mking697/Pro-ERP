import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ settings: vi.fn(), setting: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getAllSettings: m.settings, getSetting: m.setting }));
vi.mock("@/lib/tenant", () => ({ getTenantOrgId: async () => "org" }));
vi.mock("@/lib/errorLog", () => ({ logError: vi.fn() }));
vi.mock("@/db/client", () => { throw Error("DB forbidden"); });
import { sendWhatsAppMessage, sendWhatsAppBatch } from "@/lib/chatxflow";
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  m.settings.mockResolvedValue({ CHATXFLOW_API_TOKEN: "test", CHATXFLOW_BASE_URL: "https://chatxflow.online" });
  m.setting.mockImplementation(async (key: string) => key.includes("TOKEN") ? "test" : "https://chatxflow.online");
  vi.stubGlobal("fetch", m.fetch);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it.each(["headers", "body"])("aborts hanging %s exactly once and clears timers", async (phase) => {
  let signal: AbortSignal;
  m.fetch.mockImplementation((_url, init) => {
    signal = init.signal;
    const hang = () => new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(Error("aborted")), { once: true }));
    return phase === "headers" ? hang() : Promise.resolve({ ok: true, json: hang });
  });
  const pending = sendWhatsAppMessage("9876543210", "hello");
  await vi.advanceTimersByTimeAsync(20_000);
  expect(await pending).toMatchObject({ ok: false });
  expect(signal!.aborted).toBe(true);
  expect(m.fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it("loads config once and runs at most four recipients concurrently without retries", async () => {
  let active = 0; let peak = 0;
  m.fetch.mockImplementation(async (_url, init) => {
    expect(init.redirect).toBe("error");
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 100)); active--;
    return Response.json({ success: true });
  });
  const pending = sendWhatsAppBatch(Array.from({ length: 11 }, (_, i) => ({ phone: `98765432${i}`, message: "hi" })));
  await vi.advanceTimersByTimeAsync(400);
  expect(await pending).toEqual({ sent: 11, failed: 0 });
  expect(peak).toBe(4); expect(active).toBe(0);
  expect(m.settings).toHaveBeenCalledTimes(1); expect(m.setting).not.toHaveBeenCalled();
  expect(m.fetch).toHaveBeenCalledTimes(11); expect(vi.getTimerCount()).toBe(0);
});
it("overall budget aborts active calls, accounts queued recipients, never retries", async () => {
  const signals: AbortSignal[] = [];
  m.fetch.mockImplementation((_url, init) => { signals.push(init.signal); return new Promise(() => {}); });
  const pending = sendWhatsAppBatch(Array.from({ length: 100 }, () => ({ phone: "9876543210", message: "hi" })));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(await pending).toEqual({ sent: 0, failed: 100 });
  expect(m.fetch).toHaveBeenCalledTimes(12);
  expect(signals.every(s => s.aborted)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});
