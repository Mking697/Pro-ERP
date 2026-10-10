import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/settings", () => ({ getSetting: vi.fn() }));
import { callGemini, GeminiCallError } from "@/lib/chatbot/gemini";

// All transports are mocked. Never connect to Gemini, WhatsApp, or a database.
describe("PERF-06 Gemini deadlines", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("aborts a request with hanging response headers", async () => {
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: unknown, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    // Attach a handler immediately so a deadline rejection is never unhandled.
    const outcome = callGemini("test-only-key", "test", [], []).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(20_001);
    expect(signal?.aborted).toBe(true);
    // Timeout is not an overload response: preserve the existing selective retry policy.
    expect(await outcome).toBeInstanceOf(GeminiCallError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the deadline active while the response body hangs", async () => {
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: unknown, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
      } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);
    const outcome = callGemini("test-only-key", "test", [], []).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(20_001);
    expect(signal?.aborted).toBe(true);
    expect(await outcome).toBeInstanceOf(GeminiCallError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retries a transient overload but not a quota response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "high demand" } }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }] })));
    vi.stubGlobal("fetch", fetchMock);
    const success = callGemini("test-only-key", "test", [], []);
    await vi.advanceTimersByTimeAsync(501);
    expect((await success).text).toBe("OK");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ error: { message: "RESOURCE_EXHAUSTED" } }), { status: 429 }));
    await expect(callGemini("test-only-key", "test", [], [])).rejects.toMatchObject({ status: 429, quotaExceeded: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
