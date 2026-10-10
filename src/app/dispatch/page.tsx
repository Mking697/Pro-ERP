import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import DispatchBoard from "./dispatch-board";

export default async function DispatchPage() {
  const t = await getT();
  const session = await getLiveSession();

  if (!session) redirect("/login");
  if (!session.access.includes("DISPATCH_FMS")) redirect("/dashboard");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Dispatch")}
          description={t(
            "Truck Loading Dock par confirm hote hi yahan aata hai — Gate Pass issue karke stock dispatch karein, phir Mark Dispatched karke shipment band karein."
          )}
        />
        <DispatchBoard />
      </div>
    </AppShell>
  );
}
