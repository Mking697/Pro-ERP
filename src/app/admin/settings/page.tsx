import LogoForm from "./logo-form";
import SheetConnectionsForm from "./sheet-connections-form";
import WhatsAppForm from "./whatsapp-form";
import FmsShiftForm from "./fms-shift-form";
import FmsWeekoffOverridesForm from "./fms-weekoff-overrides-form";
import InwardIqcTatForm from "./inward-iqc-tat-form";
import { getT } from "@/lib/i18n/server";

export default async function AdminSettingsPage() {
  const t = await getT();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground">{t("Google Sheets, Drive, aur WhatsApp connections manage karein.")}</p>
      </div>
      <LogoForm />
      <SheetConnectionsForm />
      <WhatsAppForm />
      <FmsShiftForm />
      <FmsWeekoffOverridesForm />
      <InwardIqcTatForm />
    </div>
  );
}
