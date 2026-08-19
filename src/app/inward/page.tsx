import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import InwardBoard from "./inward-board";

export default async function InwardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");

  const canVerify = session.access.includes("IQC_CHECK");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inward &amp; IQC</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Material inward entries aur unka quality check status.
          </p>
        </div>
        <InwardBoard canVerify={canVerify} />
      </div>
    </AppShell>
  );
}
