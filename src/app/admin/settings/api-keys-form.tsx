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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { FormSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";
import { useConfirm } from "@/components/confirm-dialog";

interface ApiKeyRow {
  id: string;
  label: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export default function ApiKeysForm() {
  const t = useT();
  const confirm = useConfirm();
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [plaintextKey, setPlaintextKey] = useState<string | null>(null);

  function load() {
    fetch("/api/admin/api-keys")
      .then((res) => res.json())
      .then((data: { keys: ApiKeyRow[] }) => setKeys(data.keys))
      .catch(() => toast.error(t("API keys load nahi ho payi.")))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate() {
    if (!label.trim()) {
      toast.error(t("Key ka label dein."));
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(t(data.error ?? "Key create nahi ho payi."));
        return;
      }
      setPlaintextKey(data.plaintextKey);
      setLabel("");
      load();
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(key: ApiKeyRow) {
    const res = await fetch(`/api/admin/api-keys/${key.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(t(data.error ?? "Revoke nahi ho paya."));
      return;
    }
    toast.success(t("Key revoke ho gayi."));
    load();
  }

  if (loading || !keys) {
    return <FormSkeleton fields={3} label={t("API keys load ho rahi hain")} />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("API Keys")}</CardTitle>
        <CardDescription>
          {t(
            "Server-to-server integrations ke liye read-only API keys — Orders, Invoices, Stock, Customers, Vendors aur Dispatches /api/v1 se padhne ke liye."
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {plaintextKey && (
          <div className="rounded-md border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950">
            <p className="font-medium">{t("Ye key sirf ek baar dikhti hai — abhi copy kar lein.")}</p>
            <code className="mt-2 block break-all rounded bg-background p-2 text-xs">{plaintextKey}</code>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => {
                navigator.clipboard.writeText(plaintextKey);
                toast.success(t("Copy ho gayi."));
              }}
            >
              {t("Copy karein")}
            </Button>
            <Button size="sm" variant="ghost" className="mt-2 ml-2" onClick={() => setPlaintextKey(null)}>
              {t("Band karein")}
            </Button>
          </div>
        )}

        <div className="flex gap-2">
          <Input
            placeholder={t("Label (jaise: Tally Sync)")}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? t("Ban rahi hai...") : t("Nayi key banayein")}
          </Button>
        </div>

        <Separator />

        <div className="space-y-2">
          {keys.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("Abhi tak koi API key nahi hai.")}</p>
          )}
          {keys.map((key) => (
            <div key={key.id} className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="font-medium">
                  {key.label}{" "}
                  <span className="text-xs text-muted-foreground">({key.keyPrefix}...)</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("Bana:")} {new Date(key.createdAt).toLocaleString()} ·{" "}
                  {key.lastUsedAt
                    ? `${t("Last used:")} ${new Date(key.lastUsedAt).toLocaleString()}`
                    : t("Kabhi use nahi hui")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={key.revokedAt ? "secondary" : "default"}>
                  {key.revokedAt ? t("Revoked") : t("Active")}
                </Badge>
                {!key.revokedAt && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() =>
                      confirm.ask({
                        title: t("Key revoke karein?"),
                        description: t(
                          "Ye key is API se aage access nahi kar payegi. Ye action undo nahi ho sakta."
                        ),
                        confirmLabel: t("Haan, revoke karein"),
                        onConfirm: () => handleRevoke(key),
                      })
                    }
                  >
                    {t("Revoke")}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        {confirm.dialog}
      </CardContent>
    </Card>
  );
}
