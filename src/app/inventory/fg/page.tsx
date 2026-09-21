import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import InventoryBoard from "../inventory-board";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";

export default async function FinishedGoodsPage() {
  const t = await getT();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");
  if (!session.access.includes("INVENTORY_VIEW")) redirect("/dashboard");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Finished Goods")}
          description={t(
            "Sirf FG category ke items ka live stock — raw material/consumable se alag, taaki dono kabhi mix na hon."
          )}
        />

        <InventoryBoard
          canTransact={session.access.includes("INVENTORY_TXN")}
          canSetup={session.access.includes("INVENTORY_SETUP")}
          scope="finished"
        />
      </div>
    </AppShell>
  );
}
