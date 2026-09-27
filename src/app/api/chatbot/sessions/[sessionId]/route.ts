import { NextResponse } from "next/server";
import { requireModule } from "@/lib/auth/guard";
import { getMySession, listSessionMessages } from "@/lib/chatbot/sessions";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const guard = await requireModule("AI_CHATBOT");
  if (!guard.ok) return guard.response;

  const { sessionId } = await params;
  const session = await getMySession(guard.session.userId, sessionId);
  if (!session) {
    return NextResponse.json({ error: "Chat session not found." }, { status: 404 });
  }

  const messages = await listSessionMessages(sessionId);
  return NextResponse.json({ session, messages });
}
