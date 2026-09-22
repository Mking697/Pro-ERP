import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import PayrollAdminConsole from "./payroll-admin-console";
import MyPayslipsBoard from "./my-payslips-board";

/**
 * Payroll v1 — simple salary + proration, no PF/ESI/TDS (see src/lib/payroll/payroll.ts's
 * own header comment). Gated Role-based, not by a module grant: the admin console (salary
 * structures, generating/finalizing runs, every payslip) is Admin-only, both here and at
 * every API route it calls — this is sensitive salary data. "My Payslips" is visible to
 * every signed-in user regardless of role, same page, own tab.
 */
export default async function PayrollPage() {
  const t = await getT();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");

  const isAdmin = session.role === "Admin";

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Payroll")}
          description={t(
            "Salary structure aur monthly payroll runs — abhi ke liye koi PF/ESI/TDS deduction nahi hai."
          )}
        />

        <Tabs defaultValue={isAdmin ? "admin" : "mine"}>
          <TabsList>
            {isAdmin && <TabsTrigger value="admin">{t("Admin")}</TabsTrigger>}
            <TabsTrigger value="mine">{t("Meri Payslips")}</TabsTrigger>
          </TabsList>

          {isAdmin && (
            <TabsContent value="admin" className="mt-4">
              <PayrollAdminConsole />
            </TabsContent>
          )}
          <TabsContent value="mine" className="mt-4">
            <MyPayslipsBoard />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
