"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { FormSkeleton } from "@/components/loading-states";

interface WhatsAppSettings {
  hasToken: boolean;
  tokenMasked: string;
  phoneNumber: string;
  baseUrl: string;
}

export default function WhatsAppForm() {
  const [settings, setSettings] = useState<WhatsAppSettings | null>(null);
  const [tokenDraft, setTokenDraft] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://chatxflow.online");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [sendingReminders, setSendingReminders] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings/whatsapp")
      .then((res) => res.json())
      .then((data: WhatsAppSettings) => {
        setSettings(data);
        setPhoneNumber(data.phoneNumber);
        setBaseUrl(data.baseUrl);
      })
      .catch(() => toast.error("WhatsApp settings load nahi ho payi."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenDraft, phoneNumber, baseUrl }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Save nahi ho paya.");
        return;
      }

      toast.success("WhatsApp settings save ho gayi.");
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              hasToken: prev.hasToken || Boolean(tokenDraft.trim()),
              phoneNumber,
              baseUrl,
            }
          : prev
      );
      setTokenDraft("");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestSend() {
    setTesting(true);
    try {
      const res = await fetch("/api/admin/settings/whatsapp/test", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Test message bhej nahi paye.");
        return;
      }

      toast.success("Test message bhej diya — apna WhatsApp check karein.");
    } finally {
      setTesting(false);
    }
  }

  async function handleSendReminders() {
    setSendingReminders(true);
    try {
      const res = await fetch("/api/whatsapp/send-reminders", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Reminders bhej nahi paye.");
        return;
      }

      toast.success(`Reminders bhej diye — ${data.sent} sent, ${data.failed} failed.`);
    } finally {
      setSendingReminders(false);
    }
  }

  if (loading || !settings) {
    return <FormSkeleton fields={3} label="WhatsApp settings load ho rahi hain" />;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>WhatsApp (ChatXFlow)</CardTitle>
          <Badge variant={settings.hasToken ? "default" : "secondary"}>
            {settings.hasToken ? "Connected" : "Not connected"}
          </Badge>
        </div>
        <CardDescription>
          ChatXFlow (chatxflow.online) par apna WhatsApp QR scan se connect karein, phir yahan
          Developer API Token paste karein. Task reminders aur completion confirmations isi se
          jaate hain.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="wa-token">API Token</Label>
          <Input
            id="wa-token"
            type="password"
            value={tokenDraft}
            onChange={(e) => setTokenDraft(e.target.value)}
            placeholder={
              settings.hasToken
                ? `Saved (${settings.tokenMasked}) — badalne ke liye naya token daalein`
                : "Token paste karein"
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="wa-phone">WhatsApp Mobile Number</Label>
          <Input
            id="wa-phone"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="916392578428"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="wa-base-url">Base URL</Label>
          <Input id="wa-base-url" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          <Button
            variant="outline"
            onClick={handleTestSend}
            disabled={testing || !settings.hasToken}
          >
            {testing ? "Sending..." : "Send Test Message"}
          </Button>
        </div>

        <Separator />

        <div className="space-y-2">
          <p className="text-sm font-medium">Pending Task Reminders</p>
          <p className="text-xs text-muted-foreground">
            Har active user ko unke pending tasks ka WhatsApp reminder ek saath bhej dega. Isi
            route (<code>/api/whatsapp/send-reminders</code>) ko Vercel Cron se daily automatic
            bhi chalaya ja sakta hai — README dekhein.
          </p>
          <Button
            variant="secondary"
            onClick={handleSendReminders}
            disabled={sendingReminders || !settings.hasToken}
          >
            {sendingReminders ? "Sending..." : "Send Reminders Now"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
