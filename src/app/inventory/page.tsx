import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import InventoryBoard from "./inventory-board";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import { getInventoryItemRows } from "@/lib/inventory/service";

export default async function InventoryPage() {
  const t = await getT();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");
  if (!session.access.includes("INVENTORY_VIEW")) redirect("/dashboard");

  // Fetched here (server-rendered, same request the page itself needs) rather than left
  // for InventoryBoard's own client-side effect to fetch after hydration — removes the
  // always-shows-once loading skeleton a client-only fetch used to produce on first paint.
  const initialItems = await getInventoryItemRows();

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Inventory")}
          description={t(
            "Raw Material, Consumable aur Semi-FG ka live stock — Finished Goods yahan nahi, alag page par hai. Stock kahin store nahi hota — har baar In/Out entries se nikala jaata hai."
          )}
        />

        <InventoryBoard
          canTransact={session.access.includes("INVENTORY_TXN")}
          canSetup={session.access.includes("INVENTORY_SETUP")}
          initialItems={initialItems}
        />
      </div>
    </AppShell>
  );
}
