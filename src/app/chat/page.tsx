import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import ChatClient from "./chat-client";

export default async function ChatPage() {
  const t = await getT();
  const session = await getLiveSession();

  if (!session) redirect("/login");
  if (!session.access.includes("AI_CHATBOT")) redirect("/dashboard");

  return (
    <AppShell session={session}>
      <div className="flex h-[calc(100vh-8rem)] flex-col space-y-4">
        <PageHeader
          title={t("Pro ERP Chatbot")}
          description={t(
            "Apne Pro ERP data ke baare me sawal poochein — sirf padhne ke liye, koi bhi record ye khud badal nahi sakta."
          )}
        />
        <ChatClient />
      </div>
    </AppShell>
  );
}
