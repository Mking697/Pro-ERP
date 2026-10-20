import { redirect } from "next/navigation";
import { getLiveSession } from "@/lib/auth/live-session";
import AppShell from "@/components/app-shell";
import PageHeader from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import BillingClient from "./billing-client";

export default async function BillingPage() {
  const t = await getT();
  const session = await getLiveSession();

  if (!session) redirect("/login");
  // Billing changes every user's organization — only an Admin should be able to spend the
  // org's money, same gate as /admin/settings and every billing API route.
  if (session.role !== "Admin") redirect("/dashboard");

  return (
    <AppShell session={session}>
      <div className="space-y-6">
        <PageHeader
          title={t("Billing")}
          description={t("Apna plan dekhein aur Razorpay se seedhe pay karke upgrade karein.")}
        />
        <BillingClient />
      </div>
    </AppShell>
  );
}
