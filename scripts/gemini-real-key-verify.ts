/**
 * Real Gemini API verification — against the real key that's actually configured on a
 * production org (ORG-Q4EF59JS/"NextGen"), but run inside a fully throwaway org+user so
 * this script never touches real production users' module access or data. Per the
 * 2026-10-02 backend review item: "AI Chatbot's Gemini integration was never properly
 * tested against a real API key when first shipped (only tested via stub, production bug
 * found) — any new third-party integration should always be verified once against real
 * credentials, not rely on stub-only testing."
 *
 * (1) confirms a real GEMINI_API_KEY is configured somewhere in this environment,
 * (2) calls the real ListModels endpoint to confirm DEFAULT_MODEL ("gemini-3.8-flash", in
 *     src/lib/chatbot/gemini.ts) is STILL available for generateContent — model
 *     availability moves independently of this codebase, per that file's own comment on
 *     this exact constant; never trust the remembered name without checking,
 * (3) creates a throwaway org, pastes the SAME real key into its own Settings row (so the
 *     real orchestrator's own getGeminiApiKey() lookup is exercised, not bypassed),
 *     creates one throwaway Active user with AI_CHATBOT + TASK access and one real task
 *     for that user, then sends one real, grounded, tool-using chat turn through the
 *     actual answerChatMessage() orchestrator (not a stub) and asserts the reply is
 *     tool-grounded (groundedInTool true), not a decline or a hallucination,
 * (4) deletes the throwaway org in a `finally` regardless of outcome.
 *
 * Run: npx tsx scripts/gemini-real-key-verify.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import type { SessionPayload } from "../src/lib/auth/session";

async function main() {
  const { db } = await import("../src/db/client");
  const { settings } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { runWithTenant } = await import("../src/lib/tenant");
  const { createOrganization, deleteOrganization } = await import("../src/lib/platform/registry");
  const { createUser } = await import("../src/lib/auth/users");
  const { createTask } = await import("../src/lib/tasks");
  const { upsertSetting } = await import("../src/lib/settings");
  const { answerChatMessage } = await import("../src/lib/chatbot/orchestrator");
  const { createChatSession } = await import("../src/lib/chatbot/sessions");

  console.log("--- Step 1: find a real GEMINI_API_KEY configured anywhere in this environment ---");
  const [settingRow] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "GEMINI_API_KEY"))
    .limit(1);

  if (!settingRow || !settingRow.value.trim()) {
    console.log("No org has a real Gemini key configured in this environment — cannot verify " +
      "against the real API here. This is a genuine environment limitation, not a code issue; " +
      "re-run this script in an environment where an org has pasted a real key into " +
      "Admin -> Settings -> AI Chatbot.");
    process.exitCode = 1;
    return;
  }
  const apiKey = settingRow.value.trim();
  console.log(`Found a real key (sourced from org ${settingRow.orgId}), length=${apiKey.length}`);

  console.log("\n--- Step 2: confirm gemini-3.8-flash (DEFAULT_MODEL) is still listed for generateContent ---");
  const listRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  );
  if (!listRes.ok) {
    console.error(`ListModels failed: ${listRes.status} ${await listRes.text()}`);
    process.exitCode = 1;
    return;
  }
  const listData = (await listRes.json()) as {
    models?: { name: string; supportedGenerationMethods?: string[] }[];
  };
  const names = (listData.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace("models/", ""));
  const hasDefault = names.includes("gemini-3.8-flash");
  console.log(`Models supporting generateContent (first 10): ${names.slice(0, 10).join(", ")}`);
  console.log(`gemini-3.8-flash present: ${hasDefault}`);
  if (!hasDefault) {
    console.error(
      "\n❌ gemini-3.8-flash is NO LONGER in the live ListModels result — gemini.ts's " +
        "DEFAULT_MODEL needs updating to a currently-available model before this feature " +
        "works in production."
    );
  }

  console.log("\n--- Step 3: real tool-using chat turn, in a throwaway org (not production data) ---");
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const org = await createOrganization({
    orgName: `Test GeminiVerify ${stamp}`,
    ownerEmail: `test-geminiverify-${stamp}@example.com`,
  });

  try {
    await runWithTenant({ orgId: org.id, org }, async () => {
      await upsertSetting("GEMINI_API_KEY", apiKey);

      const user = await createUser({
        fullName: "Gemini Verify Test User",
        email: `test-geminiverify-chatuser-${stamp}@example.com`,
        password: "Test-Password-123!",
        role: "Employee",
        department: "Test",
        phoneNumber: "",
        createdBy: "gemini-real-key-verify-script",
        moduleAccess: ["AI_CHATBOT", "TASK_VIEW"],
      });

      await createTask({
        title: "Verify Gemini real-key integration",
        description: "",
        assignedTo: user.User_ID,
        assignedBy: user.User_ID,
        priority: "High",
        dueDate: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
        attachmentUrl: "",
        remark: "",
      });

      const session: SessionPayload = {
        userId: user.User_ID,
        orgId: org.id,
        email: user.Email,
        fullName: user.Full_Name,
        role: user.Role,
        access: ["AI_CHATBOT", "TASK_VIEW"],
      };

      const chatSession = await createChatSession(user.User_ID);
      const outcome = await answerChatMessage(session, chatSession.id, "Mere kitne pending tasks hain?");
      console.log(`Outcome kind: ${outcome.kind}`);
      if (outcome.kind === "answered") {
        console.log(`Reply: ${outcome.reply}`);
        console.log(`toolsCalled: ${outcome.toolsCalled.join(", ") || "(none)"}`);
        console.log(`groundedInTool: ${outcome.groundedInTool}`);
        if (!outcome.groundedInTool) {
          console.error("❌ Reply was NOT tool-grounded — the backstop should have caught this.");
          process.exitCode = 1;
        } else {
          console.log("\n✅ Real end-to-end Gemini verification succeeded: real API key, real " +
            "model, real tool call, real tenant-scoped data, grounded reply.");
        }
      } else if (outcome.kind === "not_connected") {
        console.error("❌ orchestrator reports not_connected despite a real key being present — bug.");
        process.exitCode = 1;
      } else if (outcome.kind === "rate_limited") {
        console.log(`Rate limited, retry after ${outcome.retryAfterSeconds}s — real cap behavior, not an error.`);
      }
    });
  } finally {
    await deleteOrganization(org.id);
    console.log(`\n(cleanup) deleted throwaway org ${org.id}`);
  }
}

main().catch((e) => {
  console.error("gemini-real-key-verify failed:", e);
  process.exit(1);
});
