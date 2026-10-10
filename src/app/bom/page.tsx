import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import AppShell from "@/components/app-shell";
import BomBoard from "./bom-board";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";

export default async function BomPage() {
  const t = await getT();
  const session = await getLiveSession();

  if (!session) redirect("/login");
  if (!session.access.includes("BOM_MANAGE")) redirect("/dashboard");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("BOM")}
          description={t("Har product ke liye kaun se item kitne lagte hain. BOM badalne par purani version archive ho jaati hai, mitti nahi — taaki puraane record padhe ja sakein.")}
        />

        <BomBoard canCreateFgItem={session.access.includes("INVENTORY_SETUP")} />
      </div>
    </AppShell>
  );
}
