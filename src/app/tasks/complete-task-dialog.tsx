"use client";

import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import FileUploadField from "@/components/file-upload-field";
import type { TaskRecord } from "./types";
import { useT } from "@/components/preferences-provider";

export default function CompleteTaskDialog({
  task,
  onCompleted,
}: {
  task: TaskRecord;
  onCompleted: (task: TaskRecord) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [proofUrl, setProofUrl] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleComplete() {
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${task.Task_ID}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proofUrl }),
      });
      const data = await res.json();

      if (!res.ok) {
        toast.error(t(data.error ?? "Task complete nahi ho paya."));
        return;
      }

      toast.success(t("Task complete ho gaya."));
      onCompleted(data.task);
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm">Mark Done</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{task.Title}</DialogTitle>
          <DialogDescription>
            Task complete mark karne se pehle, chahen to proof attach karein (optional).
          </DialogDescription>
        </DialogHeader>
        <FileUploadField
          label={t("Completion Proof (optional)")}
          value={proofUrl}
          onChange={setProofUrl}
        />
        <DialogFooter>
          <Button onClick={handleComplete} disabled={loading}>
            {loading ? "Saving..." : "Mark as Done"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
