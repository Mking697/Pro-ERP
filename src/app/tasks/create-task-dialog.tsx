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
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import FileUploadField from "@/components/file-upload-field";
import { PRIORITIES } from "@/lib/priority";
import type { TaskRecord, UserOption } from "./types";

export default function CreateTaskDialog({
  onCreated,
}: {
  onCreated: (task: TaskRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [priority, setPriority] = useState<string>("Medium");
  const [dueDate, setDueDate] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [remark, setRemark] = useState("");

  const selectedUser = useMemo(
    () => users.find((u) => u.userId === assignedTo) ?? null,
    [users, assignedTo]
  );

  useEffect(() => {
    if (!open) return;
    fetch("/api/users/directory")
      .then((res) => res.json())
      .then((data: { users: UserOption[] }) => setUsers(data.users ?? []))
      .catch(() => toast.error("Users list load nahi ho payi."));
  }, [open]);

  function resetForm() {
    setTitle("");
    setDescription("");
    setAssignedTo("");
    setPriority("Medium");
    setDueDate("");
    setAttachmentUrl("");
    setRemark("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assignedTo) {
      toast.error("Pehle ek user select karein.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          assignedTo,
          priority,
          dueDate,
          attachmentUrl,
          remark,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Task create nahi ho paya.");
        return;
      }

      toast.success("Task assign ho gaya.");
      onCreated(data.task);
      resetForm();
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>Assign Task</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Naya Task Assign Karein</DialogTitle>
          <DialogDescription>
            One-time task assign karein. Recurring task ke liye &quot;Assign Recurring
            Task&quot; use karein.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="assignedTo">User Name</Label>
            <Select value={assignedTo} onValueChange={(v) => v && setAssignedTo(v)}>
              <SelectTrigger id="assignedTo" className="w-full">
                <SelectValue placeholder="User select karein" />
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
            <Label htmlFor="priority">Priority</Label>
            <Select value={priority} onValueChange={(v) => v && setPriority(v)}>
              <SelectTrigger id="priority" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">Task</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="dueDate">Completion (Date & Time)</Label>
            <Input
              id="dueDate"
              type="datetime-local"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              required
            />
          </div>

          <FileUploadField
            label="Attachment (optional)"
            value={attachmentUrl}
            onChange={setAttachmentUrl}
          />

          <div className="space-y-2">
            <Label htmlFor="remark">Remark (optional)</Label>
            <Input id="remark" value={remark} onChange={(e) => setRemark(e.target.value)} />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Assigning..." : "Assign Task"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
