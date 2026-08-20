import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import { isPlatformAdmin } from "@/lib/platform/admin";
import AppShell from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import OrganizationsTable from "./organizations-table";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";

export default async function PlatformPage() {
  const t = await getT();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

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
              jaate hain — login block ho jaata hai aur uske crons chalna band. Uska data,
              sheets aur users sab waise ke waise rehte hain; dobara Active karte hi sab
              wapas chalne lagta hai. Kuch delete nahi hota.
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      </div>
    </AppShell>
  );
}
