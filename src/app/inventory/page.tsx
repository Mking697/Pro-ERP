import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import InventoryBoard from "./inventory-board";
import PageHeader from "@/components/page-header";

export default async function InventoryPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");
  if (!session.access.includes("INVENTORY_VIEW")) redirect("/dashboard");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title="Inventory"
          description="Har item ka live stock. Stock kahin store nahi hota — har baar In/Out entries se nikala jaata hai."
        />

        <InventoryBoard
          canTransact={session.access.includes("INVENTORY_TXN")}
          canSetup={session.access.includes("INVENTORY_SETUP")}
        />
      </div>
    </AppShell>
  );
}
