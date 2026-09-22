"use client";

import { useId, useRef, useState, type ChangeEvent } from "react";
import { upload } from "@vercel/blob/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      // Uploads straight from the browser to Blob storage — the file never passes through
      // this app's own serverless function, so there's no ~4.5MB Vercel body-size ceiling
      // to hit. /api/blob/upload only ever hands out a scoped, one-time token; the real
      // size/type limits it enforces live there (src/app/api/blob/upload/route.ts).
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "file";
      const pathname = `attachments/${crypto.randomUUID()}-${safeName}`;

      const blob = await upload(pathname, file, {
        access: "public",
        handleUploadUrl: "/api/blob/upload",
        contentType: file.type,
        clientPayload: file.type,
      });

      onChange(blob.url);
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

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>{label}</Label>
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border p-2 text-sm">
          <a
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-primary underline"
          >
            Attachment dekhein
          </a>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
            Remove
          </Button>
        </div>
      ) : (
        <Input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          onChange={handleFileChange}
          disabled={uploading}
        />
      )}
      {/* An upload is otherwise entirely silent for a screen-reader user. */}
      {uploading && (
        <p role="status" className="text-xs text-muted-foreground">
          Uploading...
        </p>
      )}
    </div>
  );
}
