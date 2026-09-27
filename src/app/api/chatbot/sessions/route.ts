import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { listMySessions, createChatSession } from "@/lib/chatbot/sessions";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireModule("AI_CHATBOT");
  if (!guard.ok) return guard.response;

  const sessions = await listMySessions(guard.session.userId);
  return NextResponse.json({ sessions });
}

/** Starts a brand-new, empty chat session ("New Chat" in the UI) — the first message sent
 * against it is what actually calls Gemini; this just reserves the row up front so it can
 * be shown in the session list immediately. */
export async function POST() {
  const guard = await requireModule("AI_CHATBOT");
  if (!guard.ok) return guard.response;

  const session = await createChatSession(guard.session.userId);
  return NextResponse.json({ session });
}
