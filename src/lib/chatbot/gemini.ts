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
  | { role: "model"; parts: [{ functionCall: GeminiFunctionCall }] }
  | { role: "user"; parts: [{ functionResponse: { name: string; response: Record<string, unknown> } }] };

export function userText(text: string): GeminiContent {
  return { role: "user", parts: [{ text }] };
}

export function modelText(text: string): GeminiContent {
  return { role: "model", parts: [{ text }] };
}

export function modelFunctionCall(call: GeminiFunctionCall): GeminiContent {
  return { role: "model", parts: [{ functionCall: call }] };
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

export class GeminiCallError extends Error {}

/**
 * One round-trip to Gemini: given the conversation so far and the tools this session is
 * currently entitled to, returns whatever Gemini said (text and/or function calls).
 *
 * Never throws for an ordinary API-level failure (bad key, quota, network) — those are
 * surfaced as a `GeminiCallError` so the orchestrator can log it and answer the user
 * gracefully instead of the whole request 500ing.
 */
export async function callGemini(
  apiKey: string,
  systemInstruction: string,
  contents: GeminiContent[],
  tools: ChatTool[]
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
    body.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/${DEFAULT_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new GeminiCallError(err instanceof Error ? err.message : "Gemini request failed.");
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const apiMessage = (json as { error?: { message?: string } } | null)?.error?.message;
    throw new GeminiCallError(apiMessage || `Gemini HTTP ${res.status}`);
  }

  const candidate = (json as { candidates?: Array<{ content?: { parts?: unknown[] } }> } | null)
    ?.candidates?.[0];
  const parts = (candidate?.content?.parts ?? []) as Array<{
    text?: string;
    functionCall?: GeminiFunctionCall;
  }>;

  let text = "";
  const functionCalls: GeminiFunctionCall[] = [];
  for (const part of parts) {
    if (typeof part.text === "string") text += part.text;
    if (part.functionCall) functionCalls.push(part.functionCall);
  }

  return { text, functionCalls };
}

/** A minimal, cheap call used only to validate a pasted key actually works — Settings'
 * "Test Key" button. Deliberately no tools, no system prompt beyond a trivial one. */
export async function testGeminiKey(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const turn = await callGemini(apiKey, "Reply with exactly: OK", [userText("ping")], []);
    return { ok: turn.text.trim().length > 0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
}
