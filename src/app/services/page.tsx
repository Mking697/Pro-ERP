import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import ServicesBoard from "./services-board";

export default async function ServicesPage() {
  const t = await getT();
  const session = await getLiveSession();
  if (!session) redirect("/login");

  const canWork = session.access.includes("SERVICE_FMS");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Service Jobs")}
          description={t(
            "Installation/service job punch karein, Doer assign karein, aur unka 3-step field completion (photo+location, evidence, expense) track karein."
          )}
        />
        <ServicesBoard currentUserId={session.userId} canWork={canWork} />
      </div>
    </AppShell>
  );
}
