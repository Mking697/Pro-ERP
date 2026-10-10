import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import MaintenanceBoard from "./maintenance-board";

export default async function MaintenancePage() {
  const t = await getT();
  const session = await getLiveSession();

  if (!session) redirect("/login");

  // Anyone signed in may report a breakdown against their own running step (same tier
  // as Tasks/FMS steps — being someone's assignee needs no grant). Only MAINTENANCE_FMS
  // holders get the "work the queue" actions (mark fixed, assign, cancel) — enforced here
  // for the board's buttons and again server-side in the API routes themselves.
  const canWork = session.access.includes("MAINTENANCE_FMS");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Maintenance")}
          description={t(
            "Breakdown report karte hi Production Line ka step pause ho jaata hai — jab tak aap khud confirm na karein ki line theek chal rahi hai, TAT count nahi hogi."
          )}
        />
        <MaintenanceBoard currentUserId={session.userId} canWork={canWork} />
      </div>
    </AppShell>
  );
}
