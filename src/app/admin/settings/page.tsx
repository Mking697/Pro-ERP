import LogoForm from "./logo-form";
import SheetConnectionsForm from "./sheet-connections-form";
import WhatsAppForm from "./whatsapp-form";

export default function AdminSettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground">
          Google Sheets, Drive, aur WhatsApp connections manage karein.
        </p>
      </div>
      <LogoForm />
      <SheetConnectionsForm />
      <WhatsAppForm />
    </div>
  );
}
