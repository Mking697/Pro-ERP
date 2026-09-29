"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/preferences-provider";

/**
 * "Send Report" — WhatsApps every active, evaluated user their own MIS score + breakdown
 * (see `sendPerformanceReports()`), one message per person, each carrying only their own
 * data. `rangeQuery` is the same range this page's own Excel export already uses, so
 * "Send Report" and "Excel export" always agree on which period they cover.
 */
export default function SendReportsButton({ rangeQuery }: { rangeQuery: string }) {
  const t = useT();
  const [sending, setSending] = useState(false);

  async function handleSend() {
    setSending(true);
    try {
      const res = await fetch(`/api/analytics/send-reports?${rangeQuery}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(t(data.error ?? "Reports bhej nahi paye."));
        return;
      }
      const parts = [t("{sent} log ko report bhej di gayi.").replace("{sent}", String(data.sent))];
      if (data.failed > 0) {
        parts.push(t("{failed} fail ho gaye.").replace("{failed}", String(data.failed)));
      }
      if (data.skipped > 0) {
        parts.push(t("{skipped} skip ho gaye (phone number ya score nahi).").replace("{skipped}", String(data.skipped)));
      }
      toast.success(parts.join(" "));
    } catch {
      toast.error(t("Kuch galat ho gaya. Dobara try karein."));
    } finally {
      setSending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleSend} disabled={sending}>
      <Send />
      {sending ? t("Bhej rahe hain...") : t("Send Report")}
    </Button>
  );
}
