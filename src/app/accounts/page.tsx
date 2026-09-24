import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getT } from "@/lib/i18n/server";
import AccountsBoard from "./accounts-board";
import PayablesBoard from "./payables-board";
import LedgerBoard from "./ledger-board";
import ExpensesBoard from "./expenses-board";
import PettyCashBoard from "./petty-cash-board";

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
            "Receivables (Invoice), Payables (Bill) aur poori General Ledger — Chart of Accounts, Trial Balance, P&L aur Balance Sheet."
          )}
        />
        <Tabs defaultValue="receivables">
          <TabsList className="flex-wrap">
            <TabsTrigger value="receivables">{t("Receivables")}</TabsTrigger>
            <TabsTrigger value="payables">{t("Payables")}</TabsTrigger>
            <TabsTrigger value="other-payments">{t("Other Payments")}</TabsTrigger>
            <TabsTrigger value="petty-cash">{t("Petty Cash")}</TabsTrigger>
            <TabsTrigger value="ledger">{t("Ledger")}</TabsTrigger>
          </TabsList>
          <TabsContent value="receivables" className="mt-4">
            <AccountsBoard />
          </TabsContent>
          <TabsContent value="payables" className="mt-4">
            <PayablesBoard />
          </TabsContent>
          <TabsContent value="other-payments" className="mt-4">
            <ExpensesBoard />
          </TabsContent>
          <TabsContent value="petty-cash" className="mt-4">
            <PettyCashBoard />
          </TabsContent>
          <TabsContent value="ledger" className="mt-4">
            <LedgerBoard />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
