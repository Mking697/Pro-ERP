import { and, asc, desc, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { db } from "@/db/client";
import { chatMessages, chatSessions } from "@/db/schema";
import { findById, insertRecord } from "@/db/repo";
import { getTenantOrgId } from "@/lib/tenant";
import { generateId } from "@/lib/id";

/** Chat session/message persistence — plain `id`-PK, org-scoped tables, so this file is a
 * thin wrapper over src/db/repo.ts's generic functions, same shape as src/lib/tasks.ts. */

export interface ChatSessionRecord {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessageRecord {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  toolsUsed: string[];
  createdAt: string;
}

type SessionRow = InferSelectModel<typeof chatSessions>;
type MessageRow = InferSelectModel<typeof chatMessages>;

function sessionToRecord(row: SessionRow): ChatSessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function messageToRecord(row: MessageRow): ChatMessageRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role,
    content: row.content,
    toolsUsed: row.toolsUsed,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Every session belonging to this one user — a session is private to whoever started it,
 * never shared across users even within the same org (unlike most of this app's data). */
export async function listMySessions(userId: string): Promise<ChatSessionRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.orgId, orgId), eq(chatSessions.userId, userId)))
    .orderBy(desc(chatSessions.updatedAt));
  return rows.map(sessionToRecord);
}

/** Null if the session doesn't exist, belongs to another org, OR belongs to another user —
 * a chat transcript is private, so ownership is checked here, not just tenant scoping. */
export async function getMySession(userId: string, sessionId: string): Promise<ChatSessionRecord | null> {
  const orgId = await getTenantOrgId();
  const row = await findById(chatSessions, orgId, sessionId);
  if (!row || row.userId !== userId) return null;
  return sessionToRecord(row);
}

export async function createChatSession(userId: string): Promise<ChatSessionRecord> {
  const orgId = await getTenantOrgId();
  const row = await insertRecord(chatSessions, {
    id: generateId("CHAT"),
    orgId,
    userId,
    title: "",
  });
  return sessionToRecord(row);
}

export async function listSessionMessages(sessionId: string): Promise<ChatMessageRecord[]> {
  const orgId = await getTenantOrgId();
  const rows = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.orgId, orgId), eq(chatMessages.sessionId, sessionId)))
    .orderBy(asc(chatMessages.createdAt));
  return rows.map(messageToRecord);
}

interface AppendMessageInput {
  sessionId: string;
  userId: string;
  role: "user" | "assistant";
  content: string;
  toolsUsed?: string[];
}

export async function appendMessage(input: AppendMessageInput): Promise<ChatMessageRecord> {
  const orgId = await getTenantOrgId();
  const row = await insertRecord(chatMessages, {
    id: generateId("CMSG"),
    orgId,
    sessionId: input.sessionId,
    userId: input.userId,
    role: input.role,
    content: input.content,
    toolsUsed: input.toolsUsed ?? [],
  });

  // Keep the session's own bookkeeping (list-order, first-message title) in step — a
  // plain update, not something worth a bespoke "touch" abstraction for two fields.
  const patch: { updatedAt: Date; title?: string } = { updatedAt: new Date() };
  if (input.role === "user") {
    const existing = await findById(chatSessions, orgId, input.sessionId);
    if (existing && !existing.title) {
      patch.title = input.content.slice(0, 80);
    }
  }
  await db.update(chatSessions).set(patch).where(eq(chatSessions.id, input.sessionId));

  return messageToRecord(row);
}

/** Last N messages, oldest first — what gets replayed to Gemini as conversation history for
 * multi-turn context. Capped so a very long-running session doesn't grow the prompt (and
 * the per-request cost) without bound. */
export async function recentSessionMessages(sessionId: string, limit = 20): Promise<ChatMessageRecord[]> {
  const all = await listSessionMessages(sessionId);
  return all.slice(-limit);
}
