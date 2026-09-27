import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { chatAuditLog } from "@/db/schema";
import { insertRecord } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";

/**
 * A per-org, append-only record of every chatbot query — which tools were called, by whom,
 * and whether the app-layer jailbreak backstop had to fire. Read-only, Platform Admin only
 * (see /platform's own Chatbot Audit tab), same spirit as `error_logs`.
 *
 * Deliberately a *second*, separate table from `chat_messages` (the actual transcript,
 * private to the user who had the conversation) rather than reusing it — an audit record
 * needs to exist and be readable by the Platform Admin even for organizations that never
 * open the chat transcript UI themselves, and the two have different lifecycles (a user
 * could in principle want their own transcript private; the audit log is an operator-facing
 * record of what was asked and how it was answered, not the conversation's own content
 * beyond the question itself).
 */

interface RecordAuditInput {
  userId: string;
  sessionId: string;
  question: string;
  toolsCalled: string[];
  groundedInTool: boolean;
  errorMessage?: string;
}

export async function recordChatAudit(input: RecordAuditInput): Promise<void> {
  const orgId = await getTenantOrgId();
  try {
    await insertRecord(chatAuditLog, {
      id: generateId("CAUD"),
      orgId,
      userId: input.userId,
      sessionId: input.sessionId,
      question: input.question.slice(0, 2000),
      toolsCalled: input.toolsCalled,
      groundedInTool: input.groundedInTool,
      errorMessage: (input.errorMessage ?? "").slice(0, 1000),
    });
  } catch (err) {
    // Best-effort, same convention as logError()/notifyStepComplete() — a failure to
    // record the audit trail must never break the chat turn that already succeeded.
    console.error("[chatbot] failed to record audit log:", err);
  }
}

export async function listAllChatAuditForOrg(orgId: string, limit = 200) {
  return db
    .select()
    .from(chatAuditLog)
    .where(and(eq(chatAuditLog.orgId, orgId)))
    .orderBy(desc(chatAuditLog.createdAt))
    .limit(limit);
}

/** Platform-wide, newest first — mirrors listErrorLogs()'s own cross-org shape. */
export async function listAllChatAudit(limit = 200) {
  return db.select().from(chatAuditLog).orderBy(desc(chatAuditLog.createdAt)).limit(limit);
}
