"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useT } from "@/components/preferences-provider";
import { LEAD_STATUS_LABEL, type LeadActivityRow, type LeadRow, type QuotationRow } from "./types";

function toLocalInputValue(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function LeadDetailDialog({
  leadId,
  open,
  onOpenChange,
  onChanged,
}: {
  leadId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: (lead: LeadRow) => void;
}) {
  const t = useT();
  const router = useRouter();
  const [lead, setLead] = useState<LeadRow | null>(null);
  const [activities, setActivities] = useState<LeadActivityRow[]>([]);
  const [quotations, setQuotations] = useState<QuotationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  function load() {
    Promise.all([
      fetch(`/api/leads/${leadId}`).then((res) => res.json()),
      fetch(`/api/leads/${leadId}/quotations`).then((res) => res.json()),
    ])
      .then(
        ([detail, quoteData]: [
          { lead?: LeadRow; activities?: LeadActivityRow[] },
          { quotations?: QuotationRow[] },
        ]) => {
          if (detail.lead) setLead(detail.lead);
          setActivities(detail.activities ?? []);
          setQuotations(quoteData.quotations ?? []);
        }
      )
      .catch(() => toast.error(t("Lead load nahi ho paya.")))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leadId]);

  async function transition(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Update nahi ho paya."));
        return false;
      }
      setLead(data.lead);
      onChanged(data.lead);
      load();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function createQuotation() {
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/quotations`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(t(data?.error ?? "Quotation ban nahi paya."));
        return;
      }
      toast.success(t("Quotation ban gaya."));
      onOpenChange(false);
      router.push(`/leads/quotations/${data.quotation.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {lead?.personName ?? "Lead"}
            {lead && <Badge variant="secondary">{t(LEAD_STATUS_LABEL[lead.status])}</Badge>}
          </DialogTitle>
          <DialogDescription>
            {lead?.companyName || lead?.phone
              ? [lead.companyName, lead.phone].filter(Boolean).join(" · ")
              : t("Details aur pipeline action")}
          </DialogDescription>
        </DialogHeader>

        {loading || !lead ? (
          <p className="text-sm text-muted-foreground">{t("Load ho raha hai...")}</p>
        ) : (
          <div className="space-y-4">
            <StageAction
              lead={lead}
              busy={busy}
              quotations={quotations}
              onTransition={transition}
              onCreateQuotation={createQuotation}
              onOpenQuotation={(id) => {
                onOpenChange(false);
                router.push(`/leads/quotations/${id}`);
              }}
            />

            <Separator />

            <div>
              <p className="mb-2 text-sm font-medium">History</p>
              <div className="max-h-56 space-y-2 overflow-y-auto text-sm">
                {activities.length === 0 && (
                  <p className="text-muted-foreground">{t("Abhi koi activity nahi hai.")}</p>
                )}
                {activities.map((a) => (
                  <div key={a.id} className="rounded-md border p-2">
                    <p>{a.message}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(a.createdAt).toLocaleString("en-IN")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}

function StageAction({
  lead,
  busy,
  quotations,
  onTransition,
  onCreateQuotation,
  onOpenQuotation,
}: {
  lead: LeadRow;
  busy: boolean;
  quotations: QuotationRow[];
  onTransition: (body: Record<string, unknown>) => Promise<boolean>;
  onCreateQuotation: () => void;
  onOpenQuotation: (id: string) => void;
}) {
  const t = useT();

  if (lead.status === "New") {
    return <QualifyForm busy={busy} onTransition={onTransition} />;
  }

  if (lead.status === "Qualified" || lead.status === "Follow_Up") {
    return <FollowUpAndMeetingForm lead={lead} busy={busy} onTransition={onTransition} />;
  }

  if (lead.status === "Meeting_Scheduled") {
    return <MeetingOutcomeForm busy={busy} onTransition={onTransition} />;
  }

  if (lead.status === "Negotiation" || lead.status === "Quotation_Sent") {
    const openQuotation = quotations.find((q) => q.status === "Draft" || q.status === "Sent");
    return (
      <div className="space-y-4 rounded-lg border p-3">
        <NegotiationForm busy={busy} onTransition={onTransition} />
        <Separator />
        {openQuotation ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm">
              Quotation <span className="font-medium">{openQuotation.quotationNo}</span> —{" "}
              {t(openQuotation.status)}
            </p>
            <Button size="sm" variant="outline" onClick={() => onOpenQuotation(openQuotation.id)}>
              {t("Kholein")}
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={onCreateQuotation} disabled={busy}>
            {t("Quotation Banayein")}
          </Button>
        )}
        {quotations.length > 0 && (
          <div className="space-y-1 text-xs text-muted-foreground">
            {quotations.map((q) => (
              <button
                key={q.id}
                type="button"
                className="block underline underline-offset-2 hover:text-foreground"
                onClick={() => onOpenQuotation(q.id)}
              >
                {q.quotationNo} — {q.status}
              </button>
            ))}
          </div>
        )}
        <LostButton busy={busy} onTransition={onTransition} />
      </div>
    );
  }

  if (lead.status === "Order_Confirmed") {
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
        {t("Order Confirmed ho gaya — is lead se quotation accept ho chuka hai.")}
      </div>
    );
  }

  if (lead.status === "Lost" || lead.status === "Junk") {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <p className="font-medium">{lead.status === "Junk" ? "Junk" : "Lost"}</p>
        {lead.lostReason && <p className="text-muted-foreground">{lead.lostReason}</p>}
      </div>
    );
  }

  return null;
}

function LostButton({
  busy,
  onTransition,
}: {
  busy: boolean;
  onTransition: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [showing, setShowing] = useState(false);

  if (!showing) {
    return (
      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setShowing(true)}>
        {t("Lost Mark Karein")}
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <Label>Reason</Label>
      <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button
        size="sm"
        variant="destructive"
        disabled={busy || !reason.trim()}
        onClick={async () => {
          const ok = await onTransition({ action: "lost", reason });
          if (ok) setShowing(false);
        }}
      >
        Confirm
      </Button>
    </div>
  );
}

function QualifyForm({
  busy,
  onTransition,
}: {
  busy: boolean;
  onTransition: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const t = useT();
  const [note, setNote] = useState("");

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-sm font-medium">{t("Qualify Karein")}</p>
      <Textarea
        rows={2}
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => onTransition({ action: "qualify", decision: "Qualified", note })}>
          Qualified
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive"
          disabled={busy}
          onClick={() => onTransition({ action: "qualify", decision: "Junk", note })}
        >
          Junk
        </Button>
      </div>
    </div>
  );
}

function FollowUpAndMeetingForm({
  lead,
  busy,
  onTransition,
}: {
  lead: LeadRow;
  busy: boolean;
  onTransition: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const t = useT();
  const [outcome, setOutcome] = useState<"Interested" | "Not_Interested" | "Call_Back_Later">("Interested");
  const [nextFollowUpAt, setNextFollowUpAt] = useState("");
  const [note, setNote] = useState("");

  const [meetingAt, setMeetingAt] = useState("");
  const [meetingMode, setMeetingMode] = useState("In-Person");

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border p-3">
        <p className="text-sm font-medium">{t("Follow-up Log Karein")}</p>
        <Select value={outcome} onValueChange={(v) => v && setOutcome(v as typeof outcome)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Interested">Interested</SelectItem>
            <SelectItem value="Call_Back_Later">Call Back Later</SelectItem>
            <SelectItem value="Not_Interested">Not Interested</SelectItem>
          </SelectContent>
        </Select>
        {outcome === "Call_Back_Later" && (
          <div className="space-y-2">
            <Label>{t("Agli Follow-up Date/Time")}</Label>
            <Input
              type="datetime-local"
              value={nextFollowUpAt}
              onChange={(e) => setNextFollowUpAt(e.target.value)}
            />
          </div>
        )}
        <Textarea rows={2} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button
          size="sm"
          disabled={busy || (outcome === "Call_Back_Later" && !nextFollowUpAt)}
          onClick={() =>
            onTransition({
              action: "followUp",
              outcome,
              nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt).toISOString() : undefined,
              note,
            })
          }
        >
          {t("Save karein")}
        </Button>
      </div>

      <div className="space-y-3 rounded-lg border p-3">
        <p className="text-sm font-medium">{t("Meeting Schedule Karein")}</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label>Date/Time</Label>
            <Input
              type="datetime-local"
              value={meetingAt || toLocalInputValue(lead.meetingAt)}
              onChange={(e) => setMeetingAt(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Mode</Label>
            <Input value={meetingMode} onChange={(e) => setMeetingMode(e.target.value)} />
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !meetingAt}
          onClick={() =>
            onTransition({
              action: "scheduleMeeting",
              meetingAt: new Date(meetingAt).toISOString(),
              meetingMode,
            })
          }
        >
          {t("Schedule karein")}
        </Button>
      </div>

      <LostButton busy={busy} onTransition={onTransition} />
    </div>
  );
}

function MeetingOutcomeForm({
  busy,
  onTransition,
}: {
  busy: boolean;
  onTransition: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const t = useT();
  const [outcome, setOutcome] = useState<"Done" | "Reschedule" | "Not_Interested">("Done");
  const [rescheduleAt, setRescheduleAt] = useState("");
  const [note, setNote] = useState("");

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-sm font-medium">Meeting Outcome</p>
      <Select value={outcome} onValueChange={(v) => v && setOutcome(v as typeof outcome)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="Done">Done</SelectItem>
          <SelectItem value="Reschedule">Reschedule</SelectItem>
          <SelectItem value="Not_Interested">Not Interested</SelectItem>
        </SelectContent>
      </Select>
      {outcome === "Reschedule" && (
        <div className="space-y-2">
          <Label>{t("Nayi Date/Time")}</Label>
          <Input type="datetime-local" value={rescheduleAt} onChange={(e) => setRescheduleAt(e.target.value)} />
        </div>
      )}
      <Textarea rows={2} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <Button
        size="sm"
        disabled={busy || (outcome === "Reschedule" && !rescheduleAt)}
        onClick={() =>
          onTransition({
            action: "meetingOutcome",
            outcome,
            rescheduleAt: rescheduleAt ? new Date(rescheduleAt).toISOString() : undefined,
            note,
          })
        }
      >
        {t("Save karein")}
      </Button>
      <LostButton busy={busy} onTransition={onTransition} />
    </div>
  );
}

function NegotiationForm({
  busy,
  onTransition,
}: {
  busy: boolean;
  onTransition: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const t = useT();
  const [notes, setNotes] = useState("");

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Negotiation / Requirement Notes</p>
      <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <Button
        size="sm"
        variant="outline"
        disabled={busy || !notes.trim()}
        onClick={async () => {
          const ok = await onTransition({ action: "negotiation", notes });
          if (ok) setNotes("");
        }}
      >
        {t("Note Save Karein")}
      </Button>
    </div>
  );
}
