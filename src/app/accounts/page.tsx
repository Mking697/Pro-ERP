import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getT } from "@/lib/i18n/server";
import AccountsBoard from "./accounts-board";
import PayablesBoard from "./payables-board";
import LedgerBoard from "./ledger-board";
import ExpensesBoard from "./expenses-board";
import PettyCashBoard from "./petty-cash-board";
import CreditNotesBoard from "./credit-notes-board";
import DebitNotesBoard from "./debit-notes-board";
import AgingBoard from "./aging-board";
import CreditRiskBoard from "./credit-risk-board";
import GstReportBoard from "./gst-report-board";

export default async function AccountsPage() {
  const t = await getT();
  const session = await getLiveSession();

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
            <TabsTrigger value="credit-notes">{t("Credit Notes")}</TabsTrigger>
            <TabsTrigger value="debit-notes">{t("Debit Notes")}</TabsTrigger>
            <TabsTrigger value="aging">{t("Aging")}</TabsTrigger>
            <TabsTrigger value="credit-risk">{t("Credit Risk")}</TabsTrigger>
            <TabsTrigger value="gst-report">{t("GST Report")}</TabsTrigger>
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
          <TabsContent value="credit-notes" className="mt-4">
            <CreditNotesBoard />
          </TabsContent>
          <TabsContent value="debit-notes" className="mt-4">
            <DebitNotesBoard />
          </TabsContent>
          <TabsContent value="aging" className="mt-4">
            <AgingBoard />
          </TabsContent>
          <TabsContent value="credit-risk" className="mt-4">
            <CreditRiskBoard />
          </TabsContent>
          <TabsContent value="gst-report" className="mt-4">
            <GstReportBoard />
          </TabsContent>
          <TabsContent value="ledger" className="mt-4">
            <LedgerBoard />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
