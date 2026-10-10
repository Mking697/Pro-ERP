import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import AppShell from "@/components/app-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import MyLeavesBoard from "./my-leaves-board";
import ApprovalsBoard from "./approvals-board";

export default async function LeavePage() {
  const t = await getT();
  const session = await getLiveSession();

  if (!session) redirect("/login");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Leave")}
          description={t(
            "Apni leave apply karein — approve hote hi, jitne din leave hai utne din aapke pending Tasks aur FMS steps aapke buddy ke naam chale jaayenge."
          )}
        />

        <Tabs defaultValue="mine">
          <TabsList>
            <TabsTrigger value="mine">{t("Meri Leaves")}</TabsTrigger>
            <TabsTrigger value="approvals">{t("Approvals")}</TabsTrigger>
          </TabsList>

          <TabsContent value="mine" className="mt-4">
            <MyLeavesBoard
              currentUserId={session.userId}
              canFileEmergency={session.access.includes("LEAVE_HR")}
            />
          </TabsContent>
          <TabsContent value="approvals" className="mt-4">
            <ApprovalsBoard />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
