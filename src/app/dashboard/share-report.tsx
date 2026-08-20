"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useT } from "@/components/preferences-provider";
import { useConfirm } from "@/components/confirm-dialog";

interface Share {
  token: string;
  label: string;
  rangeKey: string;
  createdBy: string;
  createdAt: string;
}

/**
 * Creates and revokes public report links.
 *
 * The link is the whole credential, so the dialog says plainly who will be able to read
 * it. Revoking is offered beside every link rather than buried elsewhere — a link that
 * cannot be taken back easily is one people are right to be nervous about creating.
 */
export default function ShareReport({ rangeKey }: { rangeKey: string }) {
  const t = useT();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<Share[]>([]);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!open) return;
    fetch("/api/reports/shares")
      .then((res) => res.json())
      .then((data: { shares?: Share[] }) => setShares(data.shares ?? []))
      .catch(() => toast.error(t("Links load nahi ho paye.")));
  }, [open, version, t]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  function urlFor(token: string) {
    return `${window.location.origin}/share/${token}`;
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch("/api/reports/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, rangeKey }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Link nahi ban paya."));
        return;
      }
      setLabel("");
      refresh();
      await copy(data.token);
      toast.success(t("Link ban gaya aur copy ho gaya."));
    } catch {
      toast.error(t("Link nahi ban paya."));
    } finally {
      setCreating(false);
    }
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(urlFor(token));
      setCopied(token);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error(t("Copy nahi ho paya."));
    }
  }

  async function revoke(token: string) {
    const res = await fetch(`/api/reports/shares?token=${encodeURIComponent(token)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error(t("Link band nahi ho paya."));
      return;
    }
    toast.success(t("Link band ho gaya."));
    refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Link2 />
            {t("Share")}
          </Button>
        }
      />
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("Report share karein")}</DialogTitle>
          <DialogDescription>
            {t(
              "Link jiske paas hoga wo ye report bina login ke dekh sakega, aur data hamesha taaza rehta hai. Wo sirf dekh sakta hai — kuch badal nahi sakta."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="share-label">{t("Is link ka naam")}</Label>
          <div className="flex gap-2">
            <Input
              id="share-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("Jaise: Supplier ke liye monthly report")}
            />
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? t("Ban raha hai...") : t("Link banayein")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              "Link me wahi sections aayenge jo aap khud dekh sakte hain. Baad me aapko naya access mile to purane link nahi badlenge."
            )}
          </p>
        </div>

        {shares.length > 0 && (
          <div className="space-y-2">
            <Label>{t("Chalu links")}</Label>
            <div className="space-y-2">
              {shares.map((s) => (
                <div
                  key={s.token}
                  className="flex flex-wrap items-center gap-2 rounded-lg border p-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.label}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      /share/{s.token.slice(0, 12)}…
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => copy(s.token)}>
                    {copied === s.token ? <Check /> : <Copy />}
                    {copied === s.token ? t("Copy ho gaya") : t("Copy")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("Link band karein")}
                    onClick={() =>
                      confirm.ask({
                        title: t("Ye link band karein?"),
                        description: t(
                          "Jis kisi ke paas ye link hai, uske liye ye turant kaam karna band kar dega. Ye wapas nahi aayega — naya link banana padega."
                        ),
                        confirmLabel: t("Haan, band karein"),
                        onConfirm: () => revoke(s.token),
                      })
                    }
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {confirm.dialog}
      </DialogContent>
    </Dialog>
  );
}
