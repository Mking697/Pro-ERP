import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import InwardBoard from "./inward-board";
import QualityRecords from "./quality-records";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import { getIqcDeviationApprover } from "@/lib/inward";

export default async function InwardPage() {
  const t = await getT();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");

  // The nav only offers this page to someone holding one of the three inward grants, but
  // the nav is not a guard — typing the URL reached the full inward list regardless. The
  // same test now runs here, matching the API and the inward report.
  if (
    !session.access.includes("INWARD_ENTRY") &&
    !session.access.includes("IQC_CHECK") &&
    !session.access.includes("IMS_VIEW")
  ) {
    redirect("/dashboard");
  }

  const canVerify = session.access.includes("IQC_CHECK");
  // The two sheets a quality check routes into are a separate grant from doing the check.
  const canViewRecords = session.access.includes("IMS_VIEW");
  // Who may Approve/Reject an "Accept Under Deviation" request (src/lib/inward/deviation.ts)
  // — the org's configured Deviation Approver, or an Admin. Resolved here (mirrors how
  // canVerify is resolved here rather than fetched separately by the client component) and
  // passed straight down to QualityRecords.
  const isAdmin = session.role === "Admin";
  const deviationApproverId = await getIqcDeviationApprover();
  const canApproveDeviation = isAdmin || (Boolean(deviationApproverId) && session.userId === deviationApproverId);

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Inward & IQC")}
          description={t("Material inward entries, unka quality check, aur uska result.")}
        />

        {canViewRecords ? (
          <Tabs defaultValue="entries">
            <TabsList>
              <TabsTrigger value="entries">Entries</TabsTrigger>
              <TabsTrigger value="failures">Failure Log</TabsTrigger>
              <TabsTrigger value="ims">IMS Inward</TabsTrigger>
            </TabsList>

            <TabsContent value="entries" className="mt-4">
              <InwardBoard canVerify={canVerify} />
            </TabsContent>
            <TabsContent value="failures" className="mt-4">
              <QualityRecords view="failures" canVerify={canVerify} canApproveDeviation={canApproveDeviation} />
            </TabsContent>
            <TabsContent value="ims" className="mt-4">
              <QualityRecords view="ims" />
            </TabsContent>
          </Tabs>
        ) : (
          <InwardBoard canVerify={canVerify} />
        )}
      </div>
    </AppShell>
  );
}
