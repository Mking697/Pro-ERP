import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, SESSION_COOKIE } from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import VendorsBoard from "./vendors-board";
import CustomersBoard from "./customers-board";

export default async function PartiesPage() {
  const t = await getT();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  if (!session) redirect("/login");
  if (!session.access.includes("PARTY_MASTER")) redirect("/dashboard");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Vendors / Customers")}
          description={t(
            "Vendor aur Customer master — ek baar bana lein, aage PO, invoice aur sales order isi se juden ge."
          )}
        />

        <Tabs defaultValue="vendors">
          <TabsList>
            <TabsTrigger value="vendors">{t("Vendors")}</TabsTrigger>
            <TabsTrigger value="customers">{t("Customers")}</TabsTrigger>
          </TabsList>

          <TabsContent value="vendors" className="mt-4">
            <VendorsBoard />
          </TabsContent>
          <TabsContent value="customers" className="mt-4">
            <CustomersBoard />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
