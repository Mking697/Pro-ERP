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
import { FormSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";

interface ChatbotSettings {
  hasKey: boolean;
  keyMasked: string;
  dailyMessageCap: number;
}

export default function ChatbotForm() {
  const t = useT();
  const [settings, setSettings] = useState<ChatbotSettings | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [dailyCap, setDailyCap] = useState("200");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings/chatbot")
      .then((res) => res.json())
      .then((data: ChatbotSettings) => {
        setSettings(data);
        setDailyCap(String(data.dailyMessageCap));
      })
      .catch(() => toast.error(t("AI Chatbot settings load nahi ho payi.")))
      .finally(() => setLoading(false));
  }, [t]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/chatbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: keyDraft, dailyMessageCap: Number(dailyCap) || undefined }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(t(data.error ?? "Save nahi ho paya."));
        return;
      }

      toast.success(t("AI Chatbot settings save ho gayi."));
      setSettings((prev) => (prev ? { ...prev, hasKey: prev.hasKey || Boolean(keyDraft.trim()) } : prev));
      setKeyDraft("");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    try {
      const res = await fetch("/api/admin/settings/chatbot/test", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        toast.error(t(data.error ?? "Key test fail ho gaya."));
        return;
      }

      toast.success(t("Gemini key kaam kar rahi hai."));
    } finally {
      setTesting(false);
    }
  }

  if (loading || !settings) {
    return <FormSkeleton fields={2} label={t("AI Chatbot settings load ho rahi hain")} />;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>AI Chatbot (Gemini)</CardTitle>
          <Badge variant={settings.hasKey ? "default" : "secondary"}>
            {settings.hasKey ? t("Connected") : t("Not connected")}
          </Badge>
        </div>
        <CardDescription>
          {t(
            "Google AI Studio se apna Gemini API key banayein aur yahan paste karein — is se aapke users apne Pro ERP data ke baare me Pro ERP Chatbot se sawal pooch sakte hain. Sirf wo users jinhe 'AI Chatbot' module access diya gaya hai, chatbot use kar sakte hain. Chatbot sirf padhne (read-only) tak seemit hai — kisi bhi record ko badal nahi sakta."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="gemini-key">Gemini API Key</Label>
          <Input
            id="gemini-key"
            type="password"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            placeholder={
              settings.hasKey
                ? `Saved (${settings.keyMasked}) — badalne ke liye naya key daalein`
                : "Key paste karein"
            }
          />
          <p className="text-xs text-muted-foreground">
            {t("Guide me 'AI Chatbot' chapter me Google AI Studio se key banane ka poora tareeka hai.")}
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="gemini-daily-cap">Daily Message Cap (per organization)</Label>
          <Input
            id="gemini-daily-cap"
            type="number"
            min={1}
            value={dailyCap}
            onChange={(e) => setDailyCap(e.target.value)}
            className="max-w-40"
          />
          <p className="text-xs text-muted-foreground">
            {t("Poore organization ke saare users milakar ek din me itne se zyada chatbot messages nahi bhej sakte — ek user ka bhi Gemini quota poora khatam na kar de, isliye.")}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? t("Saving...") : t("Save")}
          </Button>
          <Button variant="outline" onClick={handleTest} disabled={testing || !settings.hasKey}>
            {testing ? t("Testing...") : t("Test Key")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
