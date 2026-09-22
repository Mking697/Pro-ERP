import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import AccountsBoard from "./accounts-board";

export default async function AccountsPage() {
  const t = await getT();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");
  if (!session.access.includes("ACCOUNTS_FMS")) redirect("/dashboard");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Accounts")}
          description={t(
            "PDI Pass hote hi order yahan Invoice banane ke liye aata hai — Invoice No., E-way Bill aur documents dekar Issue karein."
          )}
        />
        <AccountsBoard />
      </div>
    </AppShell>
  );
}
