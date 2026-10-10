import { getSetting } from "@/lib/settings";
import type { ChatTool } from "@/lib/chatbot/tools";

/**
 * A thin, dependency-free wrapper around Gemini's REST `generateContent` endpoint (no
 * `@google/generative-ai` SDK dependency — one `fetch()` call, mirroring how
 * `src/lib/chatxflow.ts` talks to ChatXFlow's own REST API rather than pulling in a client
 * library for it).
 *
 * Per-tenant: each organization pastes its own key (Admin -> Settings -> AI Chatbot),
 * exactly like the existing ChatXFlow WhatsApp token. There is no shared/platform key.
 */

// "gemini-2.0-flash" (this constant's original value) was retired by Google after this
// feature's own live-test session (which only ever stubbed the Gemini API, never called it
// for real) — confirmed 2026-09-28 by querying the real ListModels endpoint against a real
// configured key: it no longer appears in the list of models supporting generateContent at
// all. "gemini-3.8-flash" was confirmed present in that same live list before being set here
// — don't reset this back to a guessed/remembered name without checking the real
// ListModels endpoint first, model availability on Google's side moves faster than this
// codebase's own release cadence.
const DEFAULT_MODEL = "gemini-3.8-flash";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
  /** Gemini 2.5+/3.x "thinking" models attach an opaque signature to a functionCall part in
   * their response — it must be echoed back verbatim on that same part when the call is
   * replayed into a later request's `contents` (our own multi-round tool-call loop does this
   * every time), or the API rejects the request outright with "Function call is missing a
   * thought_signature...". Confirmed live 2026-09-28 via error_logs: this was breaking every
   * tool-using chatbot question after the gemini-3.8-flash switch, not just get_team_performance
   * — see https://ai.google.dev/gemini-api/docs/thought-signatures. */
  thoughtSignature?: string;
}

export interface GeminiTurn {
  /** Plain text Gemini produced this round, if any (may be empty when it only made calls). */
  text: string;
  /** Function calls Gemini wants executed this round — normally 0 or 1, but the API allows more. */
  functionCalls: GeminiFunctionCall[];
}

/** One entry of the running conversation, in Gemini's own `contents` shape. */
export type GeminiContent =
  | { role: "user"; parts: [{ text: string }] }
  | { role: "model"; parts: [{ text: string }] }
  | { role: "model"; parts: [{ functionCall: { name: string; args: Record<string, unknown> }; thoughtSignature?: string }] }
  | { role: "user"; parts: [{ functionResponse: { name: string; response: Record<string, unknown> } }] };

export function userText(text: string): GeminiContent {
  return { role: "user", parts: [{ text }] };
}

export function modelText(text: string): GeminiContent {
  return { role: "model", parts: [{ text }] };
}

export function modelFunctionCall(call: GeminiFunctionCall): GeminiContent {
  return {
    role: "model",
    parts: [{ functionCall: { name: call.name, args: call.args }, thoughtSignature: call.thoughtSignature }],
  };
}

export function functionResponse(name: string, response: Record<string, unknown>): GeminiContent {
  return { role: "user", parts: [{ functionResponse: { name, response } }] };
}

export async function getGeminiApiKey(): Promise<string | null> {
  const key = await getSetting("GEMINI_API_KEY");
  return key && key.trim() ? key.trim() : null;
}

function toFunctionDeclarations(tools: ChatTool[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

export class GeminiCallError extends Error {
  status?: number;
  /** True for a real 429/RESOURCE_EXHAUSTED quota response — distinct from a transient 503
   * overload, since retrying a quota error within the same short window is pointless (the
   * org's own free-tier limit genuinely needs time, or a paid plan, to clear). */
  quotaExceeded?: boolean;
}

/** Google returns this for a real quota exhaustion (RESOURCE_EXHAUSTED, HTTP 429) —
 * distinct from `isRetryableOverload`'s transient 503 "high demand" case below. */
function isQuotaExceeded(status: number, message: string): boolean {
  return status === 429 || /exceeded your current quota|resource_exhausted/i.test(message);
}

/** Gemini returns HTTP 503 with a message like "This model is currently experiencing high
 * demand..." when the model itself is momentarily overloaded — a real, observed-in-production
 * condition (see CLAUDE.md's 2026-09-28 dated bullet), not a bug in this app, and genuinely
 * transient: a short retry clears it far more often than not. */
function isRetryableOverload(status: number, message: string): boolean {
  return status === 503 || /overloaded|high demand/i.test(message);
}

const RETRY_DELAYS_MS = [500, 1500];
const GEMINI_REQUEST_TIMEOUT_MS = 20_000;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function doOneCall(
  apiKey: string,
  systemInstruction: string,
  contents: GeminiContent[],
  tools: ChatTool[],
  forceTextOnly = false
): Promise<GeminiTurn> {
  const body: Record<string, unknown> = {
    contents,
    systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
  };
  if (tools.length > 0) {
    body.tools = [{ functionDeclarations: toFunctionDeclarations(tools) }];
    // AUTO (the default) still lets the model reply with plain text for a greeting — the
    // orchestrator's own app-layer backstop, not this flag, is what actually enforces
    // "must be tool-grounded". ANY would force a call even for "hi", which is a worse UX
    // for no real security gain since the backstop already discards any ungrounded reply.
    // NONE (used for the orchestrator's own forced-synthesis follow-up once the tool-call
    // round budget runs out) tells Gemini it may not call a tool at all this round, so it
    // must produce a text answer from whatever functionResponse data already sits in
    // `contents` instead of reaching for yet another tool call.
    body.toolConfig = { functionCallingConfig: { mode: forceTextOnly ? "NONE" : "AUTO" } };
  }

  let res: Response;
  let json: unknown;
  const controller = new AbortController();
  // Keep the deadline alive through BOTH headers and body consumption. Clearing it
  // after fetch resolves would still allow an indefinitely stalled response body.
  const deadline = setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS);
  try {
    res = await fetch(`${API_BASE}/${DEFAULT_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    json = await res.json().catch((err: unknown) => {
      if (controller.signal.aborted) throw err;
      return null;
    });
  } catch (err) {
    throw new GeminiCallError(
      controller.signal.aborted
        ? `Gemini request timed out after ${GEMINI_REQUEST_TIMEOUT_MS}ms.`
        : err instanceof Error ? err.message : "Gemini request failed."
    );
  } finally {
    clearTimeout(deadline);
  }
  if (!res.ok) {
    const apiMessage = (json as { error?: { message?: string } } | null)?.error?.message ?? "";
    const error = new GeminiCallError(apiMessage || `Gemini HTTP ${res.status}`);
    error.status = res.status;
    error.quotaExceeded = isQuotaExceeded(res.status, apiMessage);
    throw error;
  }

  const candidate = (json as { candidates?: Array<{ content?: { parts?: unknown[] } }> } | null)
    ?.candidates?.[0];
  const parts = (candidate?.content?.parts ?? []) as Array<{
    text?: string;
    functionCall?: { name: string; args: Record<string, unknown> };
    thoughtSignature?: string;
  }>;

  let text = "";
  const functionCalls: GeminiFunctionCall[] = [];
  for (const part of parts) {
    if (typeof part.text === "string") text += part.text;
    if (part.functionCall) {
      functionCalls.push({ ...part.functionCall, thoughtSignature: part.thoughtSignature });
    }
  }

  // Confirmed live 2026-09-28 (production error_logs): when a single turn returns SEVERAL
  // function calls at once (parallel function calling), Gemini attaches a thoughtSignature to
  // only one of them, not each — yet still hard-rejects the follow-up round-trip if any OTHER
  // functionCall part in that same turn is replayed without one. The signature represents the
  // model's reasoning for the whole turn, not one specific call, so the fix is to broadcast
  // whichever signature the turn did carry onto every function-call part of that turn before
  // it's ever replayed — never leave a same-turn sibling call signature-less.
  if (functionCalls.length > 1) {
    const turnSignature = functionCalls.find((c) => c.thoughtSignature)?.thoughtSignature;
    if (turnSignature) {
      for (const call of functionCalls) {
        if (!call.thoughtSignature) call.thoughtSignature = turnSignature;
      }
    }
  }

  return { text, functionCalls };
}

/**
 * One round-trip to Gemini: given the conversation so far and the tools this session is
 * currently entitled to, returns whatever Gemini said (text and/or function calls).
 *
 * Retries up to twice, with a short backoff, specifically when the model reports itself
 * momentarily overloaded (see `isRetryableOverload` above) — every other failure (bad key,
 * a real quota exhaustion, a malformed request) fails immediately, since retrying those
 * would just waste the same daily message cap for the same guaranteed failure.
 *
 * Never throws for an ordinary API-level failure (bad key, quota, network) — those are
 * surfaced as a `GeminiCallError` so the orchestrator can log it and answer the user
 * gracefully instead of the whole request 500ing.
 */
export async function callGemini(
  apiKey: string,
  systemInstruction: string,
  contents: GeminiContent[],
  tools: ChatTool[],
  options?: { forceTextOnly?: boolean }
): Promise<GeminiTurn> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await doOneCall(apiKey, systemInstruction, contents, tools, options?.forceTextOnly);
    } catch (err) {
      lastError = err;
      const status = err instanceof GeminiCallError ? err.status ?? 0 : 0;
      const message = err instanceof Error ? err.message : "";
      const canRetry = attempt < RETRY_DELAYS_MS.length && isRetryableOverload(status, message);
      if (!canRetry) throw err;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  // Unreachable — the loop above always either returns or throws — but keeps tsc happy
  // about every code path returning a value.
  throw lastError instanceof Error ? lastError : new GeminiCallError("Gemini request failed.");
}

/** A minimal, cheap call used only to validate a pasted key actually works — Settings'
 * "Test Key" button. Deliberately no tools, no system prompt beyond a trivial one. */
export async function testGeminiKey(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const turn = await callGemini(apiKey, "Reply with exactly: OK", [userText("ping")], []);
    return { ok: turn.text.trim().length > 0 };
  } catch (err) {
    // A real quota exhaustion is common enough on a free-tier key that it deserves its own
    // plain-language message here — the raw Google error text ("You exceeded your current
    // quota, please check your plan and billing details...") reads as a scary, technical
    // failure to a non-technical Admin, when the key itself is actually fine.
    if (err instanceof GeminiCallError && err.quotaExceeded) {
      return {
        ok: false,
        error: "Is key ki free quota abhi khatam hai — key khud sahi hai, thodi der baad (ya kal) dobara test karein, ya Google AI Studio me billing/paid plan enable karein.",
      };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
