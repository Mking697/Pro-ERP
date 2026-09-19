import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import PoIssueBoard from "./po-issue-board";
import FollowUpBoard from "./follow-up-board";
import MaterialReceivedBoard from "./material-received-board";

export default async function PurchasePage() {
  const t = await getT();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");
  if (!session.access.includes("PURCHASE_FMS")) redirect("/dashboard");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Purchase")}
          description={t(
            "Indent Approve ke baad ka flow — PO Issue, Follow Up, aur Material Received."
          )}
        />

        <Tabs defaultValue="issue">
          <TabsList>
            <TabsTrigger value="issue">{t("PO Issue")}</TabsTrigger>
            <TabsTrigger value="followup">{t("Follow Up")}</TabsTrigger>
            <TabsTrigger value="received">{t("Material Received")}</TabsTrigger>
          </TabsList>

          <TabsContent value="issue" className="mt-4">
            <PoIssueBoard />
          </TabsContent>
          <TabsContent value="followup" className="mt-4">
            <FollowUpBoard />
          </TabsContent>
          <TabsContent value="received" className="mt-4">
            <MaterialReceivedBoard />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
