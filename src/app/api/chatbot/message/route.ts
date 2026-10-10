import { NextResponse } from "next/server";
import { z } from "zod";
import { requireModule } from "@/lib/auth/guard";
import { getMySession, createChatSession } from "@/lib/chatbot/sessions";
import { answerChatMessage } from "@/lib/chatbot/orchestrator";
import { runWithTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  sessionId: z.string().optional(),
  message: z.string().trim().min(1).max(4000),
});

/**
 * The one endpoint the chat UI actually talks to for a turn: guards the module grant,
 * resolves/creates the session (always the CALLER's own — never trusts a sessionId that
 * belongs to someone else, see getMySession's own ownership check), and hands off to the
 * orchestrator, which owns every real access-control and grounding decision from here.
 */
export async function POST(request: Request) {
  const guard = await requireModule("AI_CHATBOT");
  if (!guard.ok) return guard.response;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input." }, { status: 400 });
  }

  // Reuse the guard-validated tenant for every read/write in this turn, including tools.
  return runWithTenant(guard.tenant, async () => {
    let sessionId = parsed.data.sessionId;
    if (sessionId) {
      const existing = await getMySession(guard.session.userId, sessionId);
      if (!existing) {
        return NextResponse.json({ error: "Chat session not found." }, { status: 404 });
      }
    } else {
      const created = await createChatSession(guard.session.userId);
      sessionId = created.id;
    }

    const outcome = await answerChatMessage(guard.session, sessionId, parsed.data.message);

    if (outcome.kind === "not_connected") {
      return NextResponse.json({ status: "not_connected", sessionId }, { status: 200 });
    }
    if (outcome.kind === "rate_limited") {
      return NextResponse.json(
        { status: "rate_limited", sessionId, retryAfterSeconds: outcome.retryAfterSeconds },
        { status: 429 }
      );
    }

    return NextResponse.json({
      status: "answered",
      sessionId,
      reply: outcome.reply,
      toolsCalled: outcome.toolsCalled,
      groundedInTool: outcome.groundedInTool,
    });
  });
}
