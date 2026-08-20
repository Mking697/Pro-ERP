import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import PlanBoard from "./plan-board";

export default async function PpcPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");
  // Production-floor users hold INVENTORY_TXN and reach this page to start a run, even
  // without the grant that lets them plan one.
  if (!session.access.includes("PPC_PLAN") && !session.access.includes("INVENTORY_TXN")) {
    redirect("/dashboard");
  }

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Production Planning</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan banate hi material reserve ho jaata hai. Ek hi stock do plan ko nahi mil
            sakta — jiski production date pehle hai, use pehle milta hai.
          </p>
        </div>

        <PlanBoard access={[...session.access]} />
      </div>
    </AppShell>
  );
}
