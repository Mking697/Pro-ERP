import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import BomBoard from "./bom-board";

export default async function BomPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");
  if (!session.access.includes("BOM_MANAGE")) redirect("/dashboard");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">BOM</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Har product ke liye kaun se item kitne lagte hain. BOM badalne par purani
            version archive ho jaati hai, mitti nahi — taaki puraane record padhe ja
            sakein.
          </p>
        </div>

        <BomBoard />
      </div>
    </AppShell>
  );
}
