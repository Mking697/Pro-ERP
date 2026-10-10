import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import AppShell from "@/components/app-shell";
import PlanBoard from "./plan-board";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";

export default async function PpcPage() {
  const t = await getT();
  const session = await getLiveSession();

  if (!session) redirect("/login");
  // Production-floor users hold INVENTORY_TXN and reach this page to start a run, even
  // without the grant that lets them plan one.
  if (!session.access.includes("PPC_PLAN") && !session.access.includes("INVENTORY_TXN")) {
    redirect("/dashboard");
  }

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Production Planning")}
          description={t("Plan banate hi material reserve ho jaata hai. Ek hi stock do plan ko nahi mil sakta — jiski production date pehle hai, use pehle milta hai.")}
        />

        <PlanBoard access={[...session.access]} />
      </div>
    </AppShell>
  );
}
