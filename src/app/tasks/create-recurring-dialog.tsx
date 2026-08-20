"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
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
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FREQUENCIES } from "@/lib/frequency";
import type { RecurringTaskRecord } from "@/lib/recurringTasks";
import type { UserOption } from "./types";
import { useT } from "@/components/preferences-provider";

export default function CreateRecurringDialog({
  onCreated,
}: {
  onCreated: (rule: RecurringTaskRecord) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);

  const [doerId, setDoerId] = useState("");
  const [frequency, setFrequency] = useState<string>("D");
  const [task, setTask] = useState("");
  const [assignDate, setAssignDate] = useState("");

  const selectedUser = useMemo(
    () => users.find((u) => u.userId === doerId) ?? null,
    [users, doerId]
  );

  useEffect(() => {
    if (!open) return;
    fetch("/api/users/directory")
      .then((res) => res.json())
      .then((data: { users: UserOption[] }) => setUsers(data.users ?? []))
      .catch(() => toast.error(t("Users list load nahi ho payi.")));
  }, [open, t]);

  function resetForm() {
    setDoerId("");
    setFrequency("D");
    setTask("");
    setAssignDate("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!doerId) {
      toast.error(t("Pehle ek Doer select karein."));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/recurring-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, doerId, frequency, assignDate }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(t(data.error ?? "Recurring task create nahi ho paya."));
        return;
      }

      toast.success(t("Recurring task assign ho gaya."));
      onCreated(data.rule);
      resetForm();
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline">Assign Recurring Task</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Naya Recurring Task")}</DialogTitle>
          <DialogDescription>
            Yeh ek repeating rule banata hai — occurrences roz apne-aap generate hongi
            (Holiday List ke dates skip karke).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="doerId">Doer Name</Label>
            <Select value={doerId} onValueChange={(v) => v && setDoerId(v)}>
              <SelectTrigger id="doerId" className="w-full">
                <SelectValue placeholder={t("Doer select karein")} />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.userId} value={u.userId}>
                    {u.fullName} ({u.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedUser && (
              <p className="text-xs text-muted-foreground">
                Department: {selectedUser.department || "—"}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="frequency">Frequency</Label>
            <Select value={frequency} onValueChange={(v) => v && setFrequency(v)}>
              <SelectTrigger id="frequency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map((f) => (
                  <SelectItem key={f.code} value={f.code}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="task">Task</Label>
            <Input id="task" value={task} onChange={(e) => setTask(e.target.value)} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="assignDate">Assign Date</Label>
            <Input
              id="assignDate"
              type="date"
              value={assignDate}
              onChange={(e) => setAssignDate(e.target.value)}
              required
            />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Submitting..." : "Submit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
