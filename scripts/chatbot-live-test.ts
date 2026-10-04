/**
 * Live end-to-end test for the AI Chatbot v1 (see CLAUDE.md's "AI Chatbot" section) — run
 * directly against Neon (bypassing HTTP/session — calls the lib functions inside a
 * fabricated runWithTenant() context, the same tenant scoping every request goes through),
 * same convention as scripts/fms-live-test.ts.
 *
 *   npx tsx scripts/chatbot-live-test.ts
 *
 * IMPORTANT — Gemini itself is STUBBED, not called for real: no real Gemini API key was
 * available in this environment. `globalThis.fetch` is replaced with a queue-driven mock
 * for any call to generativelanguage.googleapis.com, returning canned response shapes for
 * each scenario below; anything else falls through to the real fetch. This proves the whole
 * pipeline (module-scoping, tool execution, the "must be tool-grounded" backstop, the
 * "I couldn't find that" rule, persistence, audit logging, deleteOrganization's cascade)
 * end-to-end EXCEPT the real Gemini call itself — verify that piece separately with a real
 * key before relying on this in production, exactly as scripts/po-pdf-defaults-live-test.ts's
 * own header note about tsx + @react-pdf/hyphenate asks for its own untested piece.
 *
 * Creates its own throwaway organization + two users (one with broad module access, one
 * with none beyond AI_CHATBOT) and deletes everything via deleteOrganization() at the end.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}
function ok(msg: string) {
  console.log(`  OK: ${msg}`);
}

type FetchQueueEntry = {
  text: string;
  // `skipSignature: true` reproduces the real, confirmed-live 2026-09-28 Gemini behavior for
  // parallel function calling: when a turn returns SEVERAL function calls at once, only one
  // of them actually carries a thoughtSignature — the rest come back with none at all.
  functionCalls: { name: string; args: Record<string, unknown>; skipSignature?: boolean }[];
};

// A real Gemini "thinking" model (2.5+/3.x) attaches this to a functionCall part and expects
// it echoed back verbatim when that turn is replayed into a later request — see gemini.ts's
// own comment on GeminiFunctionCall.thoughtSignature. The stub below both returns one (so a
// real production response shape is exercised) and asserts any replayed functionCall part
// carries a signature, so this exact 2026-09-28 bug (dropped on replay, confirmed live via
// error_logs — every tool-using question broke after the gemini-3.8-flash switch) can never
// silently regress again without this test catching it.
const FAKE_THOUGHT_SIGNATURE = "fake-thought-signature-for-test";

function geminiResponseBody(entry: FetchQueueEntry) {
  const parts: Record<string, unknown>[] = [];
  if (entry.text) parts.push({ text: entry.text });
  for (const call of entry.functionCalls) {
    const { skipSignature, ...functionCall } = call;
    const part: Record<string, unknown> = { functionCall };
    if (!skipSignature) part.thoughtSignature = FAKE_THOUGHT_SIGNATURE;
    parts.push(part);
  }
  return {
    candidates: [{ content: { parts } }],
  };
}

/** Throws if any `contents` entry being sent TO Gemini replays a functionCall part without
 * the thought_signature real Gemini requires on replay — this is what makes the stub a real
 * regression guard for the 2026-09-28 bug, not just a shape-matching mock. */
function assertReplayedFunctionCallsHaveSignature(body: unknown) {
  const contents = (body as { contents?: Array<{ parts?: Array<Record<string, unknown>> }> })?.contents ?? [];
  for (const content of contents) {
    for (const part of content.parts ?? []) {
      if (part.functionCall && !part.thoughtSignature) {
        throw new Error(
          "REGRESSION: a functionCall part was replayed to Gemini with no thoughtSignature — this is the exact 2026-09-28 bug (see gemini.ts's modelFunctionCall)."
        );
      }
    }
  }
}

async function main() {
  const { runWithTenant } = await import("../src/lib/tenant");
  const { createOrganization, deleteOrganization } = await import("../src/lib/platform/registry");
  const { createUser } = await import("../src/lib/auth/users");
  const { upsertSetting } = await import("../src/lib/settings");
  const { createTask } = await import("../src/lib/tasks");
  const { getAvailableTools, findTool } = await import("../src/lib/chatbot/tools");
  const { answerChatMessage } = await import("../src/lib/chatbot/orchestrator");
  const { createChatSession, listMySessions, listSessionMessages } = await import("../src/lib/chatbot/sessions");
  const { listAllChatAuditForOrg } = await import("../src/lib/chatbot/audit");
  const { db } = await import("../src/db/client");
  const { chatSessions, chatMessages, chatAuditLog } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");

  const stamp = Date.now();
  const org = await createOrganization({
    orgName: `Chatbot Live Test ${stamp}`,
    ownerEmail: `chatbot-live-${stamp}@example.com`,
  });

  console.log(`Created org ${org.id}`);

  try {
    await runWithTenant({ orgId: org.id, org }, async () => {
      // A "power" user: AI_CHATBOT plus INVENTORY_VIEW/ORDER_FMS, to prove module-gated
      // tools show up when the grant is held.
      const powerUser = await createUser({
        fullName: "Priya Power",
        email: `priya-${stamp}@example.com`,
        password: "Password123!",
        role: "Staff",
        department: "Ops",
        phoneNumber: "9990000001",
        createdBy: "SYSTEM",
        moduleAccess: ["AI_CHATBOT", "INVENTORY_VIEW", "ORDER_FMS"],
      });

      // A "narrow" user: AI_CHATBOT only — proves module-scoped tools are absent entirely,
      // not just refused, for a user with no other grant.
      const narrowUser = await createUser({
        fullName: "Nikhil Narrow",
        email: `nikhil-${stamp}@example.com`,
        password: "Password123!",
        role: "Staff",
        department: "Ops",
        phoneNumber: "9990000002",
        createdBy: "SYSTEM",
        moduleAccess: ["AI_CHATBOT"],
      });

      // A "manager" user: AI_CHATBOT plus PERFORMANCE_VIEW — proves get_team_performance
      // (added 2026-09-28, closing a real reported gap: an Admin/PERFORMANCE_VIEW holder
      // asking about OTHER doers' tasks/MIS scores used to get the generic decline, since no
      // tool existed for it at all) is offered/withheld correctly and returns real data.
      const managerUser = await createUser({
        fullName: "Meera Manager",
        email: `meera-${stamp}@example.com`,
        password: "Password123!",
        role: "Staff",
        department: "Ops",
        phoneNumber: "9990000003",
        createdBy: "SYSTEM",
        moduleAccess: ["AI_CHATBOT", "PERFORMANCE_VIEW"],
      });

      const powerSession = {
        userId: powerUser.User_ID,
        orgId: org.id,
        email: powerUser.Email,
        fullName: powerUser.Full_Name,
        role: powerUser.Role,
        access: ["AI_CHATBOT", "INVENTORY_VIEW", "ORDER_FMS"],
        tokenVersion: 0,
      };
      const narrowSession = {
        userId: narrowUser.User_ID,
        orgId: org.id,
        email: narrowUser.Email,
        fullName: narrowUser.Full_Name,
        role: narrowUser.Role,
        access: ["AI_CHATBOT"],
        tokenVersion: 0,
      };
      const managerSession = {
        userId: managerUser.User_ID,
        orgId: org.id,
        email: managerUser.Email,
        fullName: managerUser.Full_Name,
        role: managerUser.Role,
        access: ["AI_CHATBOT", "PERFORMANCE_VIEW"],
        tokenVersion: 0,
      };

      // --- Layer 1: module scoping is enforced by omission, not just refusal -----------
      const powerTools = getAvailableTools(powerSession).map((t) => t.name);
      const narrowTools = getAvailableTools(narrowSession).map((t) => t.name);
      assert(powerTools.includes("get_item_stock"), "power user should be offered get_item_stock");
      assert(powerTools.includes("list_orders_by_status"), "power user should be offered list_orders_by_status");
      assert(!narrowTools.includes("get_item_stock"), "narrow user must NOT be offered get_item_stock");
      assert(!narrowTools.includes("list_orders_by_status"), "narrow user must NOT be offered list_orders_by_status");
      assert(narrowTools.includes("get_my_pending_tasks"), "narrow user should still get always-available tools");
      assert(findTool(narrowSession, "get_item_stock") === null, "findTool must refuse a module-gated tool for a narrow session even by direct name");
      ok("Module-scoped tools are present/absent exactly per grant (INVENTORY_VIEW/ORDER_FMS)");

      const managerTools = getAvailableTools(managerSession).map((t) => t.name);
      assert(managerTools.includes("get_team_performance"), "PERFORMANCE_VIEW holder should be offered get_team_performance");
      assert(!narrowTools.includes("get_team_performance"), "a user without PERFORMANCE_VIEW must NOT be offered get_team_performance");
      ok("get_team_performance is present/absent exactly per PERFORMANCE_VIEW grant");

      // --- Scenario 1: no Gemini key configured -> "not connected", nothing persisted --
      const sessionForNarrow1 = await createChatSession(narrowUser.User_ID);
      const notConnected = await answerChatMessage(narrowSession, sessionForNarrow1.id, "hello there");
      assert(notConnected.kind === "not_connected", `expected not_connected, got ${JSON.stringify(notConnected)}`);
      ok('No Gemini key configured -> outcome.kind === "not_connected"');

      // Now configure a (fake) key so the rest of the pipeline runs — Gemini itself is
      // stubbed below, so the key's actual validity never matters for these scenarios.
      await upsertSetting("GEMINI_API_KEY", "fake-test-key-not-a-real-gemini-key");

      // --- Set up a real pending task so get_my_pending_tasks has real data to find -----
      await createTask({
        title: "Cascade-test task",
        description: "",
        assignedTo: narrowUser.User_ID,
        assignedBy: powerUser.User_ID,
        priority: "Medium",
        dueDate: "",
        attachmentUrl: "",
        remark: "",
      });

      // --- Stub Gemini's REST endpoint ---------------------------------------------------
      const realFetch = globalThis.fetch;
      let queue: FetchQueueEntry[] = [];
      let fetchCallCount = 0;
      // 2026-09-28: when > 0, the next N calls return the real HTTP 503 "high demand" shape
      // production actually hit (see CLAUDE.md's dated bullet) instead of popping the queue
      // — proves callGemini()'s own retry-with-backoff actually recovers, not just that the
      // error is logged.
      let overloadedResponsesRemaining = 0;
      let sessionGrounded: { id: string };
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (!url.includes("generativelanguage.googleapis.com")) {
          return realFetch(input, init);
        }
        fetchCallCount++;
        if (init?.body) {
          assertReplayedFunctionCallsHaveSignature(JSON.parse(init.body as string));
        }
        if (overloadedResponsesRemaining > 0) {
          overloadedResponsesRemaining--;
          return new Response(
            JSON.stringify({
              error: { message: "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later." },
            }),
            { status: 503, headers: { "Content-Type": "application/json" } }
          );
        }
        const entry = queue.shift();
        if (!entry) throw new Error("Gemini stub queue exhausted — test scenario supplied too few canned turns.");
        return new Response(JSON.stringify(geminiResponseBody(entry)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      try {
        // --- Scenario 2: greeting never touches Gemini at all --------------------------
        queue = []; // any Gemini call here is a bug — proves the greeting shortcut is real
        const sessionGreeting = await createChatSession(narrowUser.User_ID);
        const greeting = await answerChatMessage(narrowSession, sessionGreeting.id, "hi");
        assert(greeting.kind === "answered", "greeting should be answered");
        assert(fetchCallCount === 0, "a greeting must never call Gemini");
        ok("Greeting shortcut answers without ever calling Gemini");

        // --- Scenario 3: zero tool calls -> app-layer decline backstop fires -----------
        queue = [{ text: "The capital of France is Paris.", functionCalls: [] }];
        const sessionDecline = await createChatSession(narrowUser.User_ID);
        const ungrounded = await answerChatMessage(narrowSession, sessionDecline.id, "what is the capital of France?");
        assert(ungrounded.kind === "answered", "expected an answered outcome");
        assert(!ungrounded.groundedInTool, "ungrounded reply must be marked groundedInTool: false");
        assert(!ungrounded.reply.toLowerCase().includes("paris"), "the ungrounded Gemini text must NEVER reach the user");
        assert(ungrounded.reply.includes("Pro ERP data"), "the fixed decline message should be shown instead");
        ok("Zero-tool-call Gemini reply is suppressed and replaced with the fixed decline message");

        // --- Scenario 4: a real tool call with real data -> grounded answer ------------
        queue = [
          { text: "", functionCalls: [{ name: "get_my_pending_tasks", args: {} }] },
          { text: "You have one pending task: Cascade-test task.", functionCalls: [] },
        ];
        sessionGrounded = await createChatSession(narrowUser.User_ID);
        const grounded = await answerChatMessage(narrowSession, sessionGrounded.id, "what tasks do I have pending?");
        assert(grounded.kind === "answered", "expected an answered outcome");
        assert(grounded.groundedInTool, "a real tool-backed reply must be groundedInTool: true");
        assert(grounded.toolsCalled.includes("get_my_pending_tasks"), "toolsCalled should list the tool actually used");
        assert(grounded.reply.includes("Cascade-test task"), "the real task title should appear in the answer");
        ok("A real tool call with data produces a grounded, tool-cited answer");

        // --- Scenario 5: tool call returns empty -> "I couldn't find that" rule --------
        queue = [
          { text: "", functionCalls: [{ name: "get_item_stock", args: { sku: "SKU-DOES-NOT-EXIST" } }] },
          { text: "I'll just make up a number: 42 units in stock.", functionCalls: [] },
        ];
        const sessionNotFound = await createChatSession(powerUser.User_ID);
        const notFound = await answerChatMessage(powerSession, sessionNotFound.id, "how much stock of SKU-DOES-NOT-EXIST do we have?");
        assert(notFound.kind === "answered", "expected an answered outcome");
        assert(!notFound.groundedInTool, "an empty tool result must be marked groundedInTool: false");
        assert(!notFound.reply.includes("42"), "the invented number from Gemini's own text must NEVER reach the user");
        assert(notFound.reply.toLowerCase().includes("couldn't find"), "the fixed not-found template should be shown instead");
        ok('Empty tool result -> deterministic "I couldn\'t find that" reply, never an invented number');

        // --- Scenario 6: attempted call to a tool this session isn't entitled to -------
        // Simulates a compromised/hallucinated function name reaching executeTool() even
        // though it was never in the declarations offered to Gemini for this session.
        queue = [
          { text: "", functionCalls: [{ name: "get_item_stock", args: { sku: "ANY" } }] },
          { text: "Here is the stock anyway.", functionCalls: [] },
        ];
        const sessionForbidden = await createChatSession(narrowUser.User_ID);
        const forbidden = await answerChatMessage(narrowSession, sessionForbidden.id, "check stock for me");
        assert(forbidden.kind === "answered", "expected an answered outcome");
        assert(!forbidden.groundedInTool, "a call to an ungranted tool must never be treated as grounded");
        assert(!forbidden.reply.includes("Here is the stock"), "Gemini's own text after a refused tool call must never reach the user");
        ok("A tool call outside this session's grants is refused server-side, not just left undeclared");

        // --- Scenario 7: get_team_performance returns real per-user data ---------------
        queue = [
          { text: "", functionCalls: [{ name: "get_team_performance", args: {} }] },
          { text: "Nikhil Narrow currently has the lowest score on the team.", functionCalls: [] },
        ];
        const sessionTeam = await createChatSession(managerUser.User_ID);
        const team = await answerChatMessage(managerSession, sessionTeam.id, "how is the whole team scoring?");
        assert(team.kind === "answered", "expected an answered outcome");
        assert(team.groundedInTool, "a real get_team_performance call must be grounded");
        assert(team.toolsCalled.includes("get_team_performance"), "toolsCalled should list get_team_performance");
        assert(team.reply.includes("Nikhil Narrow"), "the real per-user name from the tool's own data should appear in the answer");
        ok("get_team_performance returns real per-doer MIS data to a PERFORMANCE_VIEW holder");

        // --- Scenario 8: Gemini overloaded (real HTTP 503 shape) then recovers ----------
        overloadedResponsesRemaining = 1; // first attempt 503s, retry succeeds
        queue = [
          { text: "", functionCalls: [{ name: "get_my_pending_tasks", args: {} }] },
          { text: "You have one pending task: Cascade-test task.", functionCalls: [] },
        ];
        const callsBefore = fetchCallCount;
        const sessionRetry = await createChatSession(narrowUser.User_ID);
        const retried = await answerChatMessage(narrowSession, sessionRetry.id, "what tasks do I have pending?");
        assert(retried.kind === "answered", "expected an answered outcome despite the first attempt 503ing");
        assert(retried.groundedInTool, "the retried call should still ground a real answer");
        assert(fetchCallCount === callsBefore + 3, `expected exactly 3 fetch calls (1 failed + 2 succeeded), got ${fetchCallCount - callsBefore}`);
        ok("callGemini() retries a real HTTP 503 'high demand' response and recovers automatically");

        // --- Scenario 9: parallel function calls, only the FIRST carries a thoughtSignature --
        // Reproduces the real 2026-09-28 production bug: a single turn returning two function
        // calls at once, where Gemini attached a signature to only one of them. Without the
        // broadcast fix in gemini.ts's doOneCall(), the replayed second call would go out
        // signature-less and assertReplayedFunctionCallsHaveSignature() below would catch it.
        queue = [
          {
            text: "",
            functionCalls: [
              { name: "get_my_mis_score", args: {} },
              { name: "get_my_pending_tasks", args: {}, skipSignature: true },
            ],
          },
          { text: "Your score is on track and you have one pending task.", functionCalls: [] },
        ];
        const sessionParallel = await createChatSession(narrowUser.User_ID);
        const parallel = await answerChatMessage(narrowSession, sessionParallel.id, "my score and my pending tasks?");
        assert(parallel.kind === "answered", "expected an answered outcome for the parallel-call turn");
        assert(parallel.groundedInTool, "a parallel turn with real tool data should still ground the answer");
        assert(
          parallel.toolsCalled.includes("get_my_mis_score") && parallel.toolsCalled.includes("get_my_pending_tasks"),
          "both parallel tool calls should be recorded"
        );
        ok("A turn with parallel function calls (only one signed) still grounds a real answer, not the generic error");
      } finally {
        globalThis.fetch = realFetch;
      }

      // --- Persistence + audit sanity ---------------------------------------------------
      const sessions = await listMySessions(narrowUser.User_ID);
      assert(sessions.length >= 4, "expected at least 4 sessions created for the narrow user");
      const groundedSessionMessages = await listSessionMessages(sessionGrounded.id);
      assert(groundedSessionMessages.some((m) => m.role === "assistant" && m.toolsUsed.includes("get_my_pending_tasks")), "assistant message should record which tool it used");
      ok("Sessions/messages persisted with tool-usage recorded");

      const audit = await listAllChatAuditForOrg(org.id, 50);
      assert(audit.length >= 4, "expected at least 4 audit rows for this org");
      assert(audit.some((a) => a.groundedInTool === false), "at least one audit row should record a backstop firing");
      assert(audit.some((a) => a.groundedInTool === true), "at least one audit row should record a real grounded answer");
      ok("Audit log recorded both grounded and backstop-triggered turns");

      // Seed one more row directly in each new table so the cascade test below is real,
      // not just exercising rows the scenarios above happened to create.
      const { insertRecord } = await import("../src/db/repo");
      const { generateId } = await import("../src/lib/id");
      await insertRecord(chatSessions, { id: generateId("CHAT"), orgId: org.id, userId: powerUser.User_ID, title: "cascade-seed" });
      ok("Seeded an extra chat_sessions row for the cascade check");
      void chatMessages;
      void chatAuditLog;
      void eq;
      void db;
    });

    // --- deleteOrganization() must cascade into all three new tables ---------------------
    await deleteOrganization(org.id);

    const { getOrganization } = await import("../src/lib/platform/registry");
    const { listByOrg } = await import("../src/db/repo");
    const { chatSessions: chatSessionsTable, chatMessages: chatMessagesTable, chatAuditLog: chatAuditLogTable } =
      await import("../src/db/schema");

    assert((await getOrganization(org.id)) === null, "organization should be gone");
    assert((await listByOrg(chatSessionsTable, org.id)).length === 0, "chat_sessions rows should be gone");
    assert((await listByOrg(chatMessagesTable, org.id)).length === 0, "chat_messages rows should be gone");
    assert((await listByOrg(chatAuditLogTable, org.id)).length === 0, "chat_audit_log rows should be gone");
    ok("deleteOrganization() cascaded into chat_sessions/chat_messages/chat_audit_log with no FK violation");

    console.log("\nAll chatbot live-test scenarios passed.");
  } catch (err) {
    console.error("\nTEST FAILED:", err);
    const { getOrganization, deleteOrganization: cleanup } = await import("../src/lib/platform/registry");
    if (await getOrganization(org.id)) {
      await cleanup(org.id).catch(() => {});
    }
    process.exitCode = 1;
  }
}

main();
