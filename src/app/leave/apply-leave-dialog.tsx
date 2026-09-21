"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/components/preferences-provider";
import { LEAVE_TYPES, type LeaveRow, type UserOption } from "./types";

const EMPTY = { leaveType: "Casual" as string, startDate: "", endDate: "", reason: "", buddyId: "" };

/** Filing your own leave — no "emergency" option here on purpose: if you can fill this
 * form yourself, HR's separate Emergency path (src/app/leave/emergency-leave-dialog.tsx)
 * isn't the one you need. */
export default function ApplyLeaveDialog({
  currentUserId,
  onCreated,
}: {
  currentUserId: string;
  onCreated: (leave: LeaveRow) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/users/directory")
      .then((res) => res.json())
      .then((data: { users?: UserOption[] }) => setUserOptions(data.users ?? []))
      .catch(() => toast.error(t("Users load nahi ho paye.")));
  }, [open, t]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/leave/leaves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(t(data?.error ?? "Leave file nahi ho payi."));
        return;
      }

      toast.success(t("Leave file ho gayi."));
      setForm(EMPTY);
      setOpen(false);
      onCreated(data.leave);
    } finally {
      setSaving(false);
    }
  }

  const buddyOptions = userOptions.filter((u) => u.userId !== currentUserId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>{t("Leave ke liye Apply karein")}</Button>} />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Leave Apply karein")}</DialogTitle>
          <DialogDescription>
            {t(
              "Buddy chunein jo aapki leave ke dauraan aapke pending Tasks aur FMS steps sambhalega — approve hote hi aur leave shuru hote hi wo unke naam ho jaayenge, leave khatam hote hi wapas aapke."
            )}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="leaveType">{t("Leave Type")}</Label>
              <Select value={form.leaveType} onValueChange={(v) => v && setForm((f) => ({ ...f, leaveType: v }))}>
                <SelectTrigger id="leaveType" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAVE_TYPES.map((lt) => (
                    <SelectItem key={lt} value={lt}>
                      {t(lt)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="buddy">{t("Buddy")}</Label>
              <Select value={form.buddyId || undefined} onValueChange={(v) => v && setForm((f) => ({ ...f, buddyId: v }))}>
                <SelectTrigger id="buddy" className="w-full">
                  <SelectValue placeholder={t("Buddy chunein")} />
                </SelectTrigger>
                <SelectContent>
                  {buddyOptions.map((u) => (
                    <SelectItem key={u.userId} value={u.userId}>
                      {u.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="startDate">{t("Start Date")}</Label>
              <Input
                id="startDate"
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">{t("End Date")}</Label>
              <Input
                id="endDate"
                type="date"
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">{t("Reason")}</Label>
            <Textarea
              id="reason"
              rows={2}
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={saving}>
              {saving ? "Submitting..." : t("Apply karein")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
