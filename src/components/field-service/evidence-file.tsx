"use client";

import { useT } from "@/components/preferences-provider";

export function safeEvidenceUrl(value: string): string | null {
  if (/[\u0000-\u0020\\]/.test(value)) return null;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch { return null; }
}

/** Original file remains accessible even when its extension cannot be previewed. */
export default function EvidenceFile({ url, label, video = false }: { url: string; label: string; video?: boolean }) {
  const t = useT();
  if (!url) return null;
  const href = safeEvidenceUrl(url);
  if (!href) return <p role="alert" className="text-sm text-destructive">{t("File link available nahi hai.")}</p>;
  const pathname = href.split(/[?#]/)[0];
  return <div className="space-y-1">
    <a className="text-sm text-primary underline underline-offset-2" href={href} target="_blank" rel="noopener noreferrer">{t(label)}</a>
    {video || /\.(mp4|webm|ogg|mov)$/i.test(pathname) ? (
      <video controls preload="metadata" src={href} aria-label={t(label)} className="max-h-64 w-full rounded-md" />
    ) : /\.(png|jpe?g|gif|webp|avif)$/i.test(pathname) ? (
      // Evidence is a user-uploaded URL; not limited to configured Next image hosts.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={href} alt={t(label)} loading="lazy" className="max-h-64 rounded-md object-contain" />
    ) : null}
  </div>;
}
