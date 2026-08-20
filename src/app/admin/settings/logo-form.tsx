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
import { Button } from "@/components/ui/button";
import LogoPicker from "@/components/logo-picker";
import { FormSkeleton } from "@/components/loading-states";
import { useT } from "@/components/preferences-provider";

export default function LogoForm() {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings/logo")
      .then((res) => res.json())
      .then((data: { url?: string }) => setCurrent(data.url ?? ""))
      .catch(() => toast.error(t("Logo load nahi ho paya.")))
      .finally(() => setLoading(false));
  }, [t]);

  async function save(logo: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/logo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ logo }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(t(data?.error ?? "Logo save nahi ho paya."));
        return;
      }

      setCurrent(data.url ?? "");
      setDraft("");
      toast.success(
        data.url ? t("Logo save ho gaya — page refresh karke header me dekhein.") : "Logo hata diya."
      );
    } catch {
      toast.error(t("Logo save nahi ho paya."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization Logo</CardTitle>
        <CardDescription>
          Har page ke header me aapke organization ke naam ke saath dikhega.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <FormSkeleton fields={1} label={t("Logo load ho raha hai")} />
        ) : (
          <>
            {current && !draft && (
              <div className="flex items-center gap-3 rounded-lg border p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={current}
                  alt="Abhi ka logo"
                  className="h-12 w-12 shrink-0 rounded-md object-contain"
                />
                <p className="min-w-0 flex-1 text-sm text-muted-foreground">{t("Abhi yahi logo laga hua hai.")}</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  onClick={() => save("")}
                >{t("Hatayein")}</Button>
              </div>
            )}

            <LogoPicker
              value={draft}
              onChange={setDraft}
              label={current ? "Naya logo chunein" : "Logo chunein"}
              hint="PNG, JPG ya WebP — 1MB tak."
            />

            {draft && (
              <Button onClick={() => save(draft)} disabled={saving}>
                {saving ? "Saving..." : "Logo save karein"}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
