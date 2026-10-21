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
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { FormSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";
import { useConfirm } from "@/components/confirm-dialog";

const EVENT_TYPES = ["order.status_changed", "stock.movement_recorded"] as const;

interface WebhookRow {
  id: string;
  url: string;
  eventTypes: string[];
  isActive: boolean;
  createdAt: string;
}

export default function WebhooksForm() {
  const t = useT();
  const confirm = useConfirm();
  const [webhooks, setWebhooks] = useState<WebhookRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [plaintextSecret, setPlaintextSecret] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  function load() {
    fetch("/api/admin/webhooks")
      .then((res) => res.json())
      .then((data: { webhooks: WebhookRow[] }) => setWebhooks(data.webhooks))
      .catch(() => toast.error(t("Webhooks load nahi ho paye.")))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleType(type: string) {
    setSelectedTypes((prev) => (prev.includes(type) ? prev.filter((t2) => t2 !== type) : [...prev, type]));
  }

  async function handleCreate() {
    if (!url.trim() || selectedTypes.length === 0) {
      toast.error(t("URL aur kam se kam ek event type chunein."));
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, eventTypes: selectedTypes }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(t(data.error ?? "Webhook create nahi ho paya."));
        return;
      }
      setPlaintextSecret(data.plaintextSecret);
      setUrl("");
      setSelectedTypes([]);
      load();
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(webhook: WebhookRow) {
    const res = await fetch(`/api/admin/webhooks/${webhook.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(t(data.error ?? "Delete nahi ho paya."));
      return;
    }
    toast.success(t("Webhook delete ho gaya."));
    load();
  }

  async function handleTestPing(webhook: WebhookRow) {
    setTestingId(webhook.id);
    try {
      const res = await fetch(`/api/admin/webhooks/${webhook.id}/test`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(t(data.error ?? "Test ping bhej nahi paye."));
        return;
      }
      if (data.delivered) {
        toast.success(t("Test ping bhej diya."));
      } else {
        toast.error(t("Receiver se koi success response nahi mila."));
      }
    } finally {
      setTestingId(null);
    }
  }

  if (loading || !webhooks) {
    return <FormSkeleton fields={3} label={t("Webhooks load ho rahe hain")} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Webhooks")}</CardTitle>
        <CardDescription>
          {t(
            "Order status badalne ya stock movement hone par apne system ko real-time notify karwayein."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {plaintextSecret && (
          <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950">
            <p className="font-medium">
              {t("Ye signing secret sirf ek baar dikhta hai — abhi copy kar lein.")}
            </p>
            <code className="mt-2 block break-all rounded bg-background p-2 text-xs">{plaintextSecret}</code>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => {
                navigator.clipboard.writeText(plaintextSecret);
                toast.success(t("Copy ho gayi."));
              }}
            >
              {t("Copy karein")}
            </Button>
            <Button size="sm" variant="ghost" className="mt-2 ml-2" onClick={() => setPlaintextSecret(null)}>
              {t("Band karein")}
            </Button>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="webhook-url">{t("Receiver URL")}</Label>
          <Input
            id="webhook-url"
            placeholder={t("https://example.com/webhooks/pro-erp")}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <div className="flex flex-wrap gap-4">
            {EVENT_TYPES.map((type) => (
              <label key={type} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={selectedTypes.includes(type)}
                  onCheckedChange={() => toggleType(type)}
                />
                {type}
              </label>
            ))}
          </div>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? t("Ban raha hai...") : t("Webhook add karein")}
          </Button>
        </div>

        <Separator />

        <div className="space-y-2">
          {webhooks.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("Abhi tak koi webhook nahi hai.")}</p>
          )}
          {webhooks.map((webhook) => (
            <div key={webhook.id} className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="break-all font-medium">{webhook.url}</p>
                <p className="text-xs text-muted-foreground">
                  {webhook.eventTypes.join(", ")} · {new Date(webhook.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={webhook.isActive ? "default" : "secondary"}>
                  {webhook.isActive ? t("Active") : t("Inactive")}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={testingId === webhook.id}
                  onClick={() => handleTestPing(webhook)}
                >
                  {testingId === webhook.id ? t("Bhej rahe hain...") : t("Test ping")}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() =>
                    confirm.ask({
                      title: t("Webhook delete karein?"),
                      description: t("Ye webhook ko aage events deliver nahi honge. Ye action undo nahi ho sakta."),
                      confirmLabel: t("Haan, delete karein"),
                      onConfirm: () => handleDelete(webhook),
                    })
                  }
                >
                  {t("Delete")}
                </Button>
              </div>
            </div>
          ))}
        </div>

        {confirm.dialog}
      </CardContent>
    </Card>
  );
}
