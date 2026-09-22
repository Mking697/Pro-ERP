import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import OrdersBoard from "./orders-board";

export default async function OrdersPage() {
  const t = await getT();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");
  if (!session.access.includes("ORDER_FMS")) redirect("/dashboard");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Order")}
          description={t(
            "Quotation Accept hote hi Intake me aata hai, ya seedha Direct order banayein — Payment/Credit review, Stock reserve, aur Dispatch commit tak."
          )}
        />
        <OrdersBoard />
      </div>
    </AppShell>
  );
}
