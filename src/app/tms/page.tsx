import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import TmsBoard from "./tms-board";

export default async function TmsPage() {
  const t = await getT();
  const session = await getLiveSession();

  if (!session) redirect("/login");
  if (!session.access.includes("TMS_FMS")) redirect("/dashboard");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("TMS (Transport)")}
          description={t(
            "PDI Pass hote hi order yahan aata hai — Self-arranged shipment plan karein ya Party ke pickup ka Follow Up/Loading Dock confirm karein."
          )}
        />
        <TmsBoard />
      </div>
    </AppShell>
  );
}
