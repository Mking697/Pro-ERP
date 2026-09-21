import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import LeadsBoard from "./leads-board";

export default async function LeadsPage() {
  const t = await getT();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");
  if (!session.access.includes("LEAD_FMS")) redirect("/dashboard");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title="Leads"
          description={t(
            "Lead punch/import se le kar Qualify, Follow-up, Meeting, Negotiation aur Quotation tak — poora sales pipeline."
          )}
        />
        <LeadsBoard />
      </div>
    </AppShell>
  );
}
