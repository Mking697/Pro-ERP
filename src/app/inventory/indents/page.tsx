import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import IndentsBoard from "./indents-board";

export default async function IndentsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

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
            <h1 className="text-2xl font-semibold tracking-tight">Indents</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Approve karte hi quantity in-transit me ginne lagti hai, isliye wahi cheez
              dobara order nahi hoti. Receive karte hi stock apne aap badh jaata hai.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/inventory/reorder">Reorder</Link>}
          />
        </div>

        <IndentsBoard
          canApprove={session.access.includes("INDENT_APPROVE")}
          canReceive={session.access.includes("INVENTORY_TXN")}
        />
      </div>
    </AppShell>
  );
}
