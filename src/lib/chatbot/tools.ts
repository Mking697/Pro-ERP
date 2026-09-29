import type { SessionPayload } from "@/lib/auth/session";
import type { ModuleAccessKey } from "@/lib/moduleAccess";
import { listTasks } from "@/lib/tasks";
import { listUsers } from "@/lib/auth/users";
import { computeCombinedMisSummary, computeMisBreakdown, isOverdue } from "@/lib/mis";
import { listAllFmsRuns, listFmsRunsForUser, listMyPendingFmsSteps } from "@/lib/fms/engine";
import { getInventorySnapshot, getItemDetail, itemsNeedingReorder } from "@/lib/inventory/service";
import { listOrders, type OrderStatus } from "@/lib/orders/orders";
import { guideFor } from "@/lib/guide";
import { isPlatformAdmin } from "@/lib/platform/admin";

/**
 * Every "tool" the AI Chatbot may offer Gemini, in one registry.
 *
 * This is the whole of the chatbot's access-control story — see CLAUDE.md's "AI Chatbot"
 * section: "the chatbot is architecturally just another authenticated caller of the app's
 * own existing access-checked functions." A tool here is a thin wrapper around a real
 * function this app already has (listTasks, computeCombinedMisSummary, listOrders, ...) —
 * it NEVER constructs its own Drizzle query and NEVER touches the database directly. Every
 * one of those underlying functions already scopes itself to the current tenant via
 * getTenantOrgId()/getTenant(), so a tool inherits that scoping for free; it never receives
 * or forwards anything the caller supplies as "which org"/"which user" beyond the ones this
 * file derives from the verified session itself.
 *
 * `moduleKey: null` marks the three "always available" tools CLAUDE.md calls out
 * specifically — a user's own pending Tasks, their own MIS score (with a real per-task
 * breakdown), and their own assigned FMS steps — mirroring how Tasks/Dashboard need no
 * module grant today. Every other tool requires the same grant the equivalent page does.
 *
 * `getAvailableTools()` is what actually enforces module-scoping: it is called fresh for
 * every chat turn from the verified session (never from anything the client sent), so a
 * user who lacks a grant never receives that tool's declaration at all — Gemini is not
 * merely told not to use it, it is never offered the function in the first place. Tool
 * execution re-derives this same filtered list before running a handler (see
 * src/lib/chatbot/orchestrator.ts's executeTool), so even a tampered tool name in a
 * function-call response can't reach a handler the session isn't entitled to.
 */

export interface ToolContext {
  session: SessionPayload;
}

/** A tool's own result: `found: false` is what drives the "I couldn't find that" rule —
 * see the orchestrator, which never lets Gemini invent an answer when this fires. */
export type ToolResult =
  | { found: true; data: unknown }
  | { found: false; reason: string };

export interface ChatTool {
  name: string;
  description: string;
  /** null = always available, regardless of module grants (see file header). */
  moduleKey: ModuleAccessKey | null;
  /** A Gemini FunctionDeclaration.parameters JSON Schema object. */
  parameters: Record<string, unknown>;
  handler: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>;
}

function found(data: unknown): ToolResult {
  return { found: true, data };
}

function notFound(reason: string): ToolResult {
  return { found: false, reason };
}

const NO_PARAMS = { type: "object", properties: {} } as const;

export const CHAT_TOOLS: ChatTool[] = [
  // ---- Always available: a user's own Tasks/MIS/FMS steps (no module grant needed) ----
  {
    name: "get_my_pending_tasks",
    description:
      "Lists the current user's own pending (not-yet-completed) one-time and recurring Tasks, with title, priority, and due date.",
    moduleKey: null,
    parameters: NO_PARAMS,
    handler: async (ctx) => {
      const all = await listTasks();
      const mine = all.filter(
        (t) => t.Assigned_To === ctx.session.userId && t.Status === "Pending"
      );
      if (mine.length === 0) return notFound("No pending tasks for this user.");
      return found(
        mine.map((t) => ({
          taskId: t.Task_ID,
          title: t.Title,
          priority: t.Priority,
          dueDate: t.Due_Date,
          overdue: isOverdue(t),
        }))
      );
    },
  },
  {
    name: "get_my_mis_score",
    description:
      "The current user's own MIS (performance) score — a penalty scale, 0% is spotless and -100% is worst — combining Tasks and FMS steps, with a real per-item breakdown of which ones were On Time, Delay Done, or Not Done and why.",
    moduleKey: null,
    parameters: NO_PARAMS,
    handler: async (ctx) => {
      const [tasks, fmsRuns] = await Promise.all([
        listTasks(),
        listFmsRunsForUser(ctx.session.userId),
      ]);
      const mine = tasks.filter((t) => t.Assigned_To === ctx.session.userId);
      const summary = computeCombinedMisSummary(mine, fmsRuns);
      if (summary.score === null) {
        return notFound("Nothing has been evaluated for this user's score yet.");
      }
      const breakdown = computeMisBreakdown(mine, fmsRuns);
      return found({
        scorePercent: summary.score,
        onTime: summary.onTime,
        delayDone: summary.delay,
        notDone: summary.notDone,
        totalEvaluated: summary.totalEvaluated,
        breakdown: breakdown.map((r) => ({
          label: r.label,
          when: r.when,
          outcome: r.outcome,
          reason: r.reason,
        })),
      });
    },
  },
  {
    name: "get_my_pending_fms_steps",
    description:
      "Lists the current user's own pending FMS (Flow Management System) steps across every flow they're part of — step name, flow/template name, and TAT deadline.",
    moduleKey: null,
    parameters: NO_PARAMS,
    handler: async (ctx) => {
      const runs = await listMyPendingFmsSteps(ctx.session.userId);
      if (runs.length === 0) return notFound("No pending FMS steps for this user.");
      return found(
        runs.map((r) => ({
          runId: r.Run_ID,
          stepName: r.Step_Name,
          flowName: r.Template_Name,
          tatDeadline: r.TAT_Deadline,
        }))
      );
    },
  },
  {
    name: "search_guidebook",
    description:
      "Searches the in-app Guidebook (the plain-language manual for how this app's own features work) for sections matching a query. Use this for 'how do I...' questions about using Pro ERP, not for questions about the user's own data.",
    moduleKey: null,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Keywords to search the guidebook for, e.g. 'leave approval' or 'MIS score'.",
        },
      },
      required: ["query"],
    },
    handler: async (ctx, args) => {
      const query = String(args.query ?? "").trim().toLowerCase();
      if (!query) return notFound("No search query given.");
      const chapters = guideFor({
        role: ctx.session.role,
        access: ctx.session.access,
        isPlatformAdmin: isPlatformAdmin(ctx.session.email),
        locale: "en",
      });
      // A whole-phrase substring match was too brittle — Gemini's own phrasing of a query
      // ("leave approval") rarely matches a section's exact wording verbatim, which was
      // driving it to re-search with slightly different wording over and over (see
      // orchestrator.ts's forced-synthesis fallback, added for the same underlying bug).
      // Matching on individual words instead, ranked by how many words hit, finds the
      // right section far more often on the first try.
      const words = query.split(/\s+/).filter((w) => w.length >= 3);
      const terms = words.length > 0 ? words : [query];
      const hits: { chapter: string; section: string; summary: string; score: number }[] = [];
      for (const chapter of chapters) {
        for (const section of chapter.sections) {
          const haystack = `${section.title} ${section.summary}`.toLowerCase();
          const score = terms.filter((term) => haystack.includes(term)).length;
          if (score > 0) {
            hits.push({ chapter: chapter.title, section: section.title, summary: section.summary, score });
          }
        }
      }
      if (hits.length === 0) return notFound("No guidebook section matched that query.");
      hits.sort((a, b) => b.score - a.score);
      return found(hits.slice(0, 5).map(({ chapter, section, summary }) => ({ chapter, section, summary })));
    },
  },

  // ---- Module-gated: proof the module-scoping boundary is real ----
  {
    name: "get_item_stock",
    description:
      "Looks up one inventory item's current live stock position by its SKU — on-hand, free, committed, in-transit, and reorder status.",
    moduleKey: "INVENTORY_VIEW",
    parameters: {
      type: "object",
      properties: {
        sku: { type: "string", description: "The item's SKU code." },
      },
      required: ["sku"],
    },
    handler: async (_ctx, args) => {
      const sku = String(args.sku ?? "").trim();
      if (!sku) return notFound("No SKU given.");
      const detail = await getItemDetail(sku);
      if (!detail) return notFound(`No item found for SKU "${sku}".`);
      const s = detail.stock;
      return found({
        sku: s.item.SKU,
        itemName: s.item.Item_Name,
        uom: s.item.UOM,
        onHand: s.onHand,
        free: s.free,
        committed: s.committed,
        orderReserved: s.orderReserved,
        inTransit: s.inTransit,
        status: s.status,
      });
    },
  },
  {
    name: "list_low_stock_items",
    description:
      "Lists inventory items currently at or below their reorder point (Critical/Low/Out of Stock), worst shortfall first.",
    moduleKey: "INVENTORY_VIEW",
    parameters: NO_PARAMS,
    handler: async () => {
      const snapshot = await getInventorySnapshot();
      const low = itemsNeedingReorder(snapshot.items);
      if (low.length === 0) return notFound("No items are currently at or below their reorder point.");
      return found(
        low.slice(0, 15).map((s) => ({
          sku: s.item.SKU,
          itemName: s.item.Item_Name,
          free: s.free,
          reorderPoint: s.rop,
          status: s.status,
        }))
      );
    },
  },
  {
    name: "list_orders_by_status",
    description:
      "Lists Sales Orders, optionally filtered to one status (e.g. Payment_Review, Stock_Check, Dispatch_Pending, Ready_For_PDI, Cancelled). Returns customer, value, and status per order.",
    moduleKey: "ORDER_FMS",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description:
            "Optional exact order status to filter to. Omit to list every order regardless of status.",
        },
      },
    },
    handler: async (_ctx, args) => {
      const rawStatus = args.status ? String(args.status).trim() : undefined;
      // listOrders()'s own type only accepts a real OrderStatus — an arbitrary string from
      // the model is cast, not validated against the enum, but the worst case is Postgres
      // itself rejecting an unrecognised value (caught below), never a silently-wrong scope.
      const orders = await listOrders(rawStatus as OrderStatus | undefined).catch(() => []);
      if (orders.length === 0) {
        return notFound(rawStatus ? `No orders found with status "${rawStatus}".` : "No orders found.");
      }
      return found(
        orders.slice(0, 20).map((o) => ({
          orderId: o.id,
          customer: o.partyName,
          status: o.status,
          orderValue: o.orderValue,
          dispatchCommitDate: o.dispatchCommitDate,
        }))
      );
    },
  },
  {
    name: "get_team_performance",
    description:
      "Lists every active user's MIS (performance) score and On Time/Delay/Not Done counts, worst score first — the same data the Team Performance page shows. Use this for questions about OTHER people's tasks/scores, not the asking user's own (use get_my_mis_score for that instead).",
    moduleKey: "PERFORMANCE_VIEW",
    parameters: NO_PARAMS,
    handler: async () => {
      const [users, allTasks, fmsRuns] = await Promise.all([
        listUsers(),
        listTasks(),
        listAllFmsRuns(),
      ]);
      const rows = users
        .filter((u) => u.Status === "Active")
        .map((u) => {
          const summary = computeCombinedMisSummary(
            allTasks.filter((t) => t.Assigned_To === u.User_ID),
            fmsRuns.filter((r) => r.Assigned_To === u.User_ID)
          );
          return { user: u, summary };
        })
        .sort((a, b) => (b.summary.score ?? -1) - (a.summary.score ?? -1));
      if (rows.length === 0) return notFound("No active users found.");
      return found(
        rows.map(({ user, summary }) => ({
          name: user.Full_Name,
          role: user.Role,
          scorePercent: summary.score,
          onTime: summary.onTime,
          delayDone: summary.delay,
          notDone: summary.notDone,
          totalEvaluated: summary.totalEvaluated,
        }))
      );
    },
  },
];

/**
 * The tools this specific session may use right now — recomputed fresh from the verified
 * session on every call, never cached or trusted from client input. This is the actual
 * module-scoping enforcement point: a tool with a `moduleKey` the session doesn't hold is
 * simply absent from the returned list, so it is never sent to Gemini as an available
 * function in the first place.
 */
export function getAvailableTools(session: SessionPayload): ChatTool[] {
  return CHAT_TOOLS.filter((tool) => tool.moduleKey === null || session.access.includes(tool.moduleKey));
}

export function findTool(session: SessionPayload, name: string): ChatTool | null {
  return getAvailableTools(session).find((t) => t.name === name) ?? null;
}

/** One canned example question per tool this session actually has access to — shown on
 * first opening the chat (CLAUDE.md's "access-scoped suggested-questions" item), generated
 * from the same live grant check as everything else here rather than a fixed list that
 * could suggest a question the viewer has no access to answer. */
const SUGGESTIONS: Record<string, string> = {
  get_my_pending_tasks: "What tasks are still pending for me?",
  get_my_mis_score: "What is my MIS score, and why?",
  get_my_pending_fms_steps: "Do I have any pending FMS steps right now?",
  search_guidebook: "How does leave approval work?",
  get_item_stock: "What's the free stock for SKU <your item's SKU>?",
  list_low_stock_items: "Which items are currently low on stock?",
  list_orders_by_status: "List orders that are in Payment_Review.",
  get_team_performance: "How is the whole team scoring right now?",
};

export function suggestedQuestions(session: SessionPayload): string[] {
  return getAvailableTools(session)
    .map((t) => SUGGESTIONS[t.name])
    .filter((q): q is string => Boolean(q));
}
