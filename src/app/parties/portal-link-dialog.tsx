"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Link2, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/components/preferences-provider";
import { useConfirm } from "@/components/confirm-dialog";
import type { CustomerRow } from "./types";

/**
 * Customer Portal magic link — see src/lib/parties/customerPortal.ts for the scope/
 * rationale. Opens lazily (fetches/creates the link only once the dialog is opened, not
 * on every board render) and mirrors share-report.tsx's own Copy/Regenerate interaction
 * shape, since both are "the link IS the credential" features.
 */
export default function PortalLinkDialog({
  customer,
  open,
  onOpenChange,
}: {
  customer: CustomerRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const confirm = useConfirm();
  const [url, setUrl] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fetches/creates the link the moment the dialog opens for a customer — mirrors
  // share-report.tsx's own `useEffect(() => { if (!open) return; fetch(...) }, [open])`
  // shape. The `open` prop here is set externally (CustomersBoard sets `portalCustomer`
  // directly on a button click), so `Dialog`'s own `onOpenChange` never fires for THIS
  // open — it only fires when the Dialog itself requests a close (overlay/Escape/X) — so
  // this effect, not onOpenChange, is the only reliable "just opened" signal. No separate
  // `loading` flag: "still loading" is simply `open && !url`, computed in JSX below,
  // rather than a second piece of state that could drift out of sync with the fetch.
  useEffect(() => {
    if (!open || !customer) return;
    let cancelled = false;
    fetch(`/api/parties/customers/${encodeURIComponent(customer.Customer_ID)}/portal-link`, {
      method: "POST",
    })
      .then((res) => res.json().then((data) => ({ res, data })))
      .then(({ res, data }) => {
        if (cancelled) return;
        if (!res.ok) {
          toast.error(t(data.error ?? "Link nahi ban paya."));
          return;
        }
        setUrl(data.url);
      });
    return () => {
      cancelled = true;
    };
  }, [open, customer, t]);

  async function handleCopy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleSend() {
    if (!customer) return;
    setSending(true);
    try {
      const res = await fetch(
        `/api/parties/customers/${encodeURIComponent(customer.Customer_ID)}/portal-link/send`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(t(data.error ?? "WhatsApp bhej nahi paye."));
        return;
      }
      setUrl(data.url);
      toast.success(t("Portal link WhatsApp par bhej diya."));
    } finally {
      setSending(false);
    }
  }

  async function handleRegenerate() {
    if (!customer) return;
    confirm.ask({
      title: t("Link regenerate karein?"),
      description: t("Purana link turant kaam karna band kar dega — agar leak ho gaya ho tabhi regenerate karein."),
      onConfirm: async () => {
        setRegenerating(true);
        try {
          const res = await fetch(
            `/api/parties/customers/${encodeURIComponent(customer.Customer_ID)}/portal-link/regenerate`,
            { method: "POST" }
          );
          const data = await res.json();
          if (!res.ok) {
            toast.error(t(data.error ?? "Regenerate nahi ho paya."));
            return;
          }
          setUrl(data.url);
          toast.success(t("Naya link ban gaya — purana ab kaam nahi karega."));
        } finally {
          setRegenerating(false);
        }
      },
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setUrl(null);
          setCopied(false);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Customer Portal Link")}</DialogTitle>
          <DialogDescription>
            {t("Is link se {name} apne saare orders aur invoices dekh sakte hain — koi login/password nahi chahiye.").replace(
              "{name}",
              customer?.Customer_Name ?? ""
            )}
          </DialogDescription>
        </DialogHeader>

        {open && !url && <p className="text-sm text-muted-foreground">{t("Link ban raha hai...")}</p>}

        {url && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Input readOnly value={url} className="font-mono text-xs" />
              <Button type="button" variant="outline" size="icon" onClick={handleCopy} aria-label={t("Link copy karein")}>
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={handleSend} disabled={sending || !customer?.Phone}>
                <Send />
                {sending ? t("Bhej rahe hain...") : t("WhatsApp par bhejein")}
              </Button>
              <Button type="button" variant="outline" onClick={handleRegenerate} disabled={regenerating}>
                <RefreshCw />
                {regenerating ? t("Regenerate ho raha hai...") : t("Regenerate karein")}
              </Button>
            </div>
            {!customer?.Phone && (
              <p className="text-xs text-muted-foreground">
                <Link2 className="mr-1 inline size-3" />
                {t("Is customer ka phone number save nahi hai — Copy karke manually bhej sakte hain.")}
              </p>
            )}
          </div>
        )}

        <DialogFooter />

        {confirm.dialog}
      </DialogContent>
    </Dialog>
  );
}
