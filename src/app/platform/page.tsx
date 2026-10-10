import { notFound, redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import { isPlatformAdmin } from "@/lib/platform/admin";
import AppShell from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import OrganizationsTable from "./organizations-table";
import ErrorLogsTable from "./error-logs-table";
import UsageMetricsTable from "./usage-metrics-table";
import ChatbotAuditTable from "./chatbot-audit-table";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";

export default async function PlatformPage() {
  const t = await getT();
  const session = await getLiveSession();

  if (!session) redirect("/login");

  // 404 rather than 403 — an organization Admin has no business learning this page exists.
  if (!isPlatformAdmin(session.email)) notFound();

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Platform")}
          description={t("Is install par chal rahe saare organizations. Ye sirf platform operator ke liye hai — kisi organization ke Admin ko ye page dikhta hi nahi.")}
        />

        <OrganizationsTable />

        <Card>
          <CardHeader>
            <CardTitle>{t("Suspend karne ka matlab")}</CardTitle>
            <CardDescription>
              Suspend karte hi us organization ke saare users agli request par hi bahar ho
              jaate hain — login block ho jaata hai aur uske crons chalna band. Uska data
              aur users sab waise ke waise rehte hain; dobara Active karte hi sab
              wapas chalne lagta hai. Kuch delete nahi hota.
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Per-Org Usage")}</CardTitle>
            <CardDescription>
              {t("Har organization ka aaj ka request count aur approximate storage share — Neon khud kisi tenant ko nahi jaanta, ye ek approximation hai, asli bill nahi.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UsageMetricsTable />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Server Errors")}</CardTitle>
            <CardDescription>
              {t("Kisi bhi organization me hui uncaught server error yahan dikhti hai — koi bhi cron job ki nakami ya WhatsApp send fail bhi. Sirf padhne ke liye.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ErrorLogsTable />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("Chatbot Audit")}</CardTitle>
            <CardDescription>
              {t("Kisi bhi organization me AI Chatbot se pooche gaye har sawal ka record — kaunse tools call hue aur jawab tool-grounded tha ya nahi. Sirf padhne ke liye.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChatbotAuditTable />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
