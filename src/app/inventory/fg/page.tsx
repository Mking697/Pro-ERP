import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import AppShell from "@/components/app-shell";
import InventoryBoard from "../inventory-board";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import { getInventoryItemRows } from "@/lib/inventory/service";

export default async function FinishedGoodsPage() {
  const t = await getT();
  const session = await getLiveSession();

  if (!session) redirect("/login");
  if (!session.access.includes("INVENTORY_VIEW")) redirect("/dashboard");

  const initialItems = await getInventoryItemRows();

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
          initialItems={initialItems}
        />
      </div>
    </AppShell>
  );
}
