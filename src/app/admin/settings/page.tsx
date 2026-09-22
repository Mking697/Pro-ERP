import LogoForm from "./logo-form";
import WhatsAppForm from "./whatsapp-form";
import FmsShiftForm from "./fms-shift-form";
import FmsWeekoffOverridesForm from "./fms-weekoff-overrides-form";
import HolidayListForm from "./holiday-list-form";
import InwardIqcTatForm from "./inward-iqc-tat-form";
import PurchaseSetupForm from "./purchase-setup-form";
import LeaveApprovalSetupForm from "./leave-approval-setup-form";
import LeaveQuotaSetupForm from "./leave-quota-setup-form";
import QuotationSetupForm from "./quotation-setup-form";
import OrderSetupForm from "./order-setup-form";
import { getT } from "@/lib/i18n/server";

export default async function AdminSettingsPage() {
  const t = await getT();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground">{t("Logo, WhatsApp, aur baaki organization settings manage karein.")}</p>
      </div>
      <LogoForm />
      <WhatsAppForm />
      <FmsShiftForm />
      <FmsWeekoffOverridesForm />
      <HolidayListForm />
      <InwardIqcTatForm />
      <PurchaseSetupForm />
      <QuotationSetupForm />
      <OrderSetupForm />
      <LeaveApprovalSetupForm />
      <LeaveQuotaSetupForm />
    </div>
  );
}
