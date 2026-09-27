import { boolean, index, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./platform";

/**
 * The AI Chatbot (per-tenant Gemini key, see CLAUDE.md's "AI Chatbot" section) — a real
 * conversation history plus a separate, append-only audit trail of every query. Both are
 * plain-`id`-PK, org-scoped tables, so `src/db/repo.ts`'s generic `listByOrg`/`findById`/
 * `insertRecord`/`updateById` all work against them without a bespoke query.
 *
 * The chatbot never gets its own database access beyond these two tables — every actual
 * business-data read it performs goes through the app's existing, already access-checked
 * functions (see src/lib/chatbot/tools.ts). These tables only ever hold the chat transcript
 * and the audit record of what was asked/answered, never a copy of business data itself.
 */

export const chatMessageRoleEnum = pgEnum("chat_message_role", ["user", "assistant"]);

export const chatSessions = pgTable(
  "chat_sessions",
  {
    // Chat_Session_ID, e.g. "CHAT-xxxx".
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id").notNull(),
    // First user message, trimmed — a short label for the session list. Blank until the
    // first message is sent.
    title: text("title").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("chat_sessions_org_id_user_id_idx").on(table.orgId, table.userId),
  ]
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    sessionId: text("session_id").notNull(),
    userId: text("user_id").notNull(),
    role: chatMessageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    // Names of tools actually invoked while producing this message — "" role="user" rows
    // always carry an empty array. Purely informational/UI (e.g. "used: My Tasks, My MIS
    // Score"); the real access-control decision already happened before any tool ran.
    toolsUsed: text("tools_used").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("chat_messages_org_id_session_id_idx").on(table.orgId, table.sessionId),
  ]
);

/**
 * One row per user question, independent of the transcript above — this is what
 * `/platform` reads (Platform Admin only), mirroring `error_logs`' own "diagnostic/audit
 * data, read-only, never edited" shape. `groundedInTool` is false exactly when the app-layer
 * jailbreak backstop fired (Gemini answered without calling any offered tool, or the one
 * tool called came back empty) — see src/lib/chatbot/orchestrator.ts.
 */
export const chatAuditLog = pgTable(
  "chat_audit_log",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    question: text("question").notNull(),
    toolsCalled: text("tools_called").array().notNull().default([]),
    groundedInTool: boolean("grounded_in_tool").notNull().default(false),
    errorMessage: text("error_message").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("chat_audit_log_org_id_idx").on(table.orgId),
    index("chat_audit_log_org_id_created_at_idx").on(table.orgId, table.createdAt),
  ]
);
