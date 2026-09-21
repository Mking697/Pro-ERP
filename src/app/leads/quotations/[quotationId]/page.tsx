import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import QuotationBuilder from "./quotation-builder";

export default async function QuotationPage({
  params,
}: {
  params: Promise<{ quotationId: string }>;
}) {
  const t = await getT();
  const { quotationId } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");
  if (!session.access.includes("LEAD_FMS")) redirect("/dashboard");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title="Quotation"
          description={t("Header, line items aur totals — Draft me jitni baar chahe badla ja sakta hai.")}
        />
        <QuotationBuilder quotationId={quotationId} />
      </div>
    </AppShell>
  );
}
