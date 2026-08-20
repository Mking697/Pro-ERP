"use client";

import { useRef, useState, type ChangeEvent } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/components/preferences-provider";

const ACCEPTED = "image/png,image/jpeg,image/webp";
const MAX_KB = 1024;

/**
 * Picks an organization logo and hands back a data URL.
 *
 * Deliberately not an upload: at signup there is no organization yet and no session, so
 * an endpoint that accepted a file there would have to accept it from anyone. The bytes
 * ride along with the form instead, and the server stores them only once the signup has
 * actually succeeded.
 */
export default function LogoPicker({
  value,
  onChange,
  label = "Logo (optional)",
  hint,
}: {
  value: string;
  onChange: (dataUrl: string) => void;
  label?: string;
  hint?: string;
}) {
  const t = useT();
  // Defaulted here rather than in the parameter list: a default value is evaluated
  // before the component body, where the hook does not exist yet.
  const hintText =
    hint ?? t("PNG, JPG ya WebP — 1MB tak. Ye aapke system ke header me dikhega.");
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!ACCEPTED.split(",").includes(file.type)) {
      toast.error(t("Logo PNG, JPG ya WebP hona chahiye."));
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    if (file.size > MAX_KB * 1024) {
      toast.error(`Logo ${MAX_KB / 1024}MB se chhota hona chahiye.`);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setReading(true);
    const reader = new FileReader();
    reader.onload = () => {
      onChange(typeof reader.result === "string" ? reader.result : "");
      setReading(false);
    };
    reader.onerror = () => {
      toast.error(t("Logo padha nahi ja saka."));
      setReading(false);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="logo">{label}</Label>

      {value ? (
        <div className="flex items-center gap-3 rounded-lg border p-3">
          {/* A data URL or blob URL is not a configured next/image host, so plain img. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Chuna hua logo"
            className="h-12 w-12 shrink-0 rounded-md object-contain"
          />
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">{t("Logo taiyaar hai.")}</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange("");
              if (inputRef.current) inputRef.current.value = "";
            }}
          >{t("Hatayein")}</Button>
        </div>
      ) : (
        <>
          <Input
            ref={inputRef}
            id="logo"
            type="file"
            accept={ACCEPTED}
            onChange={handleChange}
            disabled={reading}
          />
          <p className="text-xs text-muted-foreground">{hintText}</p>
        </>
      )}
    </div>
  );
}

/** Kept alongside the picker so the header and the picker agree on how a logo renders. */
export function OrgLogo({
  url,
  name,
  className = "size-8",
}: {
  url: string | null;
  name: string;
  className?: string;
}) {
  if (!url) {
    // Falls back to the product mark, so an org without a logo still looks deliberate.
    return (
      <span
        aria-hidden="true"
        className={`grid shrink-0 place-items-center rounded-md bg-foreground text-xs font-bold text-background ${className}`}
      >
        PE
      </span>
    );
  }

  return (
    <Image
      src={url}
      alt={`${name} logo`}
      width={32}
      height={32}
      unoptimized
      className={`shrink-0 rounded-md object-contain ${className}`}
    />
  );
}
