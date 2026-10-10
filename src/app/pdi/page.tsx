import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import PdiBoard from "./pdi-board";

export default async function PdiPage() {
  const t = await getT();
  const session = await getLiveSession();

  if (!session) redirect("/login");
  if (!session.access.includes("PDI_FMS")) redirect("/dashboard");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("PDI")}
          description={t(
            "Order Ready For PDI hote hi Intake me aata hai — inspect karne se pehle dekhein ki stock ka wait to nahi ho raha, phir Pass ya Fail record karein."
          )}
        />
        <PdiBoard />
      </div>
    </AppShell>
  );
}
