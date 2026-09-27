import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { getGeminiApiKey } from "@/lib/chatbot/gemini";
import { suggestedQuestions } from "@/lib/chatbot/tools";

export const dynamic = "force-dynamic";

/** What the chat UI needs before showing anything: whether Gemini is actually configured
 * (the "AI Assistant isn't connected yet" state — CLAUDE.md's other non-negotiable v1
 * piece, alongside "I couldn't find that") and this viewer's own access-scoped example
 * questions. */
export async function GET() {
  const guard = await requireModule("AI_CHATBOT");
  if (!guard.ok) return guard.response;

  const apiKey = await getGeminiApiKey();
  return NextResponse.json({
    connected: Boolean(apiKey),
    suggestedQuestions: suggestedQuestions(guard.session),
  });
}
