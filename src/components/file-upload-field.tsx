"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ACCEPTED_TYPES =
  "image/*,video/*,application/pdf,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_SIZE_MB = 4;

export default function FileUploadField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      toast.error(`File ${MAX_SIZE_MB}MB se chhoti honi chahiye.`);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/drive/upload", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Upload nahi ho paya.");
        return;
      }

      onChange(data.url);
      toast.success("File upload ho gayi.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
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
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          onChange={handleFileChange}
          disabled={uploading}
        />
      )}
      {uploading && <p className="text-xs text-muted-foreground">Uploading...</p>}
    </div>
  );
}
