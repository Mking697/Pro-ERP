"use client";

import type { ReactNode } from "react";
import { Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/**
 * Wraps a Doer's name in the Performance table so clicking it opens their own MIS score
 * breakdown — reusing the same `ScoreBreakdown` table a person already sees for their own
 * score on `/dashboard`, here rendered per row so an Admin/PERFORMANCE_VIEW holder can see
 * exactly which tasks/FMS steps produced anyone's number, not just their own.
 *
 * `children` is the already-rendered `<ScoreBreakdown>` output — a Client Component cannot
 * import and mount an async Server Component itself, so the caller (a Server Component)
 * resolves it and hands it down, the standard Next.js composition for this.
 *
 * `scoreLabel`/`scoreColorClass` arrive pre-formatted from the caller rather than this file
 * importing `formatScore`/`getScoreColorClass` from `@/lib/mis` itself — that module also
 * exports `isFmsStepOverdue` from `@/lib/fms/engine`, which transitively reaches
 * `next/headers`, so importing anything from it at all from a Client Component fails the
 * build. The caller (already a Server Component that imports `@/lib/mis` safely) does the
 * formatting instead.
 *
 * `exportHref`, when given, is a plain downloadable-CSV link (this same breakdown, as a
 * file) — an `<a download>` needs no client-side state of its own, so it sits directly in
 * the header rather than becoming its own component.
 */
export default function DoerScoreDialog({
  name,
  scoreLabel,
  scoreColorClass,
  exportHref,
  children,
}: {
  name: string;
  scoreLabel: string;
  scoreColorClass: string;
  exportHref?: string;
  children: ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger className="rounded font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
        {name}
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader className="flex-row items-start justify-between gap-4">
          <div>
            <DialogTitle>{name}</DialogTitle>
            <DialogDescription>
              Score: <span className={`font-semibold ${scoreColorClass}`}>{scoreLabel}</span>
            </DialogDescription>
          </div>
          {exportHref && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              render={
                <a href={exportHref} download>
                  <Download />
                  Export
                </a>
              }
            />
          )}
        </DialogHeader>
        <div className="max-h-[65vh] overflow-y-auto">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
