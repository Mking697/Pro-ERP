import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import MyStepsBoard from "./my-steps-board";
import TemplatesBoard from "./templates-board";
import FmsHistoryBoard from "./fms-history-board";

export default async function FmsPage() {
  const t = await getT();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");

  const canManage = session.access.includes("FMS_ADMIN");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("FMS")}
          description={t("Multi-step FMS processes — apne pending steps dekhein, ya (agar authorized hain) naya FMS template banayein.")}
        />

        <Tabs defaultValue="my-steps">
          <TabsList>
            <TabsTrigger value="my-steps">{t("Mere Steps")}</TabsTrigger>
            <TabsTrigger value="history">{t("History")}</TabsTrigger>
            {canManage && <TabsTrigger value="templates">{t("Templates")}</TabsTrigger>}
          </TabsList>

          <TabsContent value="my-steps" className="mt-4">
            <MyStepsBoard />
          </TabsContent>
          <TabsContent value="history" className="mt-4">
            <FmsHistoryBoard />
          </TabsContent>
          {canManage && (
            <TabsContent value="templates" className="mt-4">
              <TemplatesBoard isAdmin={session.role === "Admin"} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </AppShell>
  );
}
