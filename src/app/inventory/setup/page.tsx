import { redirect } from "next/navigation";
import Link from "next/link";
import { getLiveSession } from "@/lib/auth/live-session";
import AppShell from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import BulkSetup from "./bulk-setup";

export default async function InventorySetupPage() {
  const session = await getLiveSession();

  if (!session) redirect("/login");
  if (!session.access.includes("INVENTORY_SETUP")) redirect("/dashboard");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mb-1"
            render={<Link href="/inventory">← Inventory</Link>}
          />
          <h1 className="text-2xl font-semibold tracking-tight">Bulk Setup</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Kai items ke planning fields ek saath bharein. Sirf jo cell aap badlenge wahi
            save hoga — baaki row waise ki waisi rahegi.
          </p>
        </div>

        <BulkSetup />
      </div>
    </AppShell>
  );
}
