import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import ComplaintsBoard from "./complaints-board";

export default async function ComplaintsPage() {
  const t = await getT();
  const session = await getLiveSession();
  if (!session) redirect("/login");

  const canWork = session.access.includes("COMPLAINT_FMS");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Complaints")}
          description={t(
            "Customer complaint punch karein, Doer assign karein, aur resolution ka 3-step field completion track karein."
          )}
        />
        <ComplaintsBoard currentUserId={session.userId} canWork={canWork} />
      </div>
    </AppShell>
  );
}
