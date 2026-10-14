import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import SiteVisitsBoard from "./site-visits-board";

export default async function SiteVisitsPage() {
  const t = await getT();
  const session = await getLiveSession();
  if (!session) redirect("/login");

  const canWork = session.access.includes("SITE_VISIT_FMS");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Site Visits")}
          description={t(
            "Inspection/survey visit raise karein, Doer assign karein, aur visit report ka 3-step field completion track karein."
          )}
        />
        <SiteVisitsBoard currentUserId={session.userId} canWork={canWork} />
      </div>
    </AppShell>
  );
}
