"use client";

import { useId, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { toast } from "sonner";
import { FileUp, Loader2, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useT } from "@/components/preferences-provider";

const ACCEPTED_TYPES =
  "image/*,video/*,application/pdf,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export default function FileUploadField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
}) {
  const t = useT();
  // The label was rendered but never associated, so this announced as an unnamed file
  // button — on the task-completion flow, where the proof upload lives.
  const inputId = useId();
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadFile(file: File) {
    setUploading(true);
    try {
      // Posted straight to this app's own /api/blob/upload route, which writes the file
      // to local disk on this server (src/lib/storage.ts) — there's no serverless
      // function body-size ceiling to work around on a self-hosted VPS, so the file goes
      // straight through this server, scoped server-side to the caller's own session/org
      // (never a client-supplied path).
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/blob/upload", { method: "POST", body: formData });
      const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
      if (!res.ok || !body.url) {
        throw new Error(body.error || t("Upload nahi ho paya. Internet check karke dobara try karein."));
      }

      onChange(body.url);
      toast.success(t("File upload ho gayi."));
    } catch (err) {
      toast.error(
        err instanceof Error && err.message
          ? err.message
          : t("Upload nahi ho paya. Internet check karke dobara try karein.")
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void uploadFile(file);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragOver(false);
    if (uploading) return;
    const file = event.dataTransfer.files?.[0];
    if (file) void uploadFile(file);
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{label}</Label>
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 p-2.5 text-sm">
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 items-center gap-2 truncate text-primary hover:underline"
          >
            <Paperclip aria-hidden="true" className="size-4 shrink-0" />
            <span className="truncate">Attachment dekhein</span>
          </a>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
            <X aria-hidden="true" className="size-3.5" />
            Remove
          </Button>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            if (!uploading) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-6 text-center transition-colors duration-150",
            uploading
              ? "cursor-not-allowed border-muted bg-muted/30"
              : dragOver
                ? "border-primary bg-primary/5"
                : "border-input hover:border-primary/50 hover:bg-muted/30"
          )}
        >
          {uploading ? (
            <Loader2 aria-hidden="true" className="size-5 animate-spin text-muted-foreground" />
          ) : (
            <FileUp aria-hidden="true" className={cn("size-5", dragOver ? "text-primary" : "text-muted-foreground")} />
          )}
          <p className="text-xs text-muted-foreground">
            {uploading
              ? t("Uploading...")
              : t("File yahan drag karein, ya click karke choose karein")}
          </p>
          <input
            id={inputId}
            ref={inputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            onChange={handleFileChange}
            disabled={uploading}
            className="sr-only"
          />
        </label>
      )}
      {/* An upload is otherwise entirely silent for a screen-reader user. */}
      {uploading && (
        <p role="status" className="sr-only">
          Uploading...
        </p>
      )}
    </div>
  );
}
