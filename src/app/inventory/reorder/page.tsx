import { redirect } from "next/navigation";
import Link from "next/link";
import { getLiveSession } from "@/lib/auth/live-session";
import AppShell from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import ReorderBoard from "./reorder-board";

export default async function ReorderPage() {
  const session = await getLiveSession();

  if (!session) redirect("/login");
  if (!session.access.includes("INVENTORY_VIEW")) redirect("/dashboard");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 mb-1"
              render={<Link href="/inventory">← Inventory</Link>}
            />
            <h1 className="text-2xl font-semibold tracking-tight">Reorder</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Reorder point = ADC × Lead Time × Safety Factor. Jo item us line par ya
              neeche hai wahi yahan hai — aur jo maal pehle se raaste me hai wo gina ja
              chuka hai.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/inventory/indents">Indents</Link>}
          />
        </div>

        <ReorderBoard canRaise={session.access.includes("INVENTORY_TXN")} />
      </div>
    </AppShell>
  );
}
