"use client";

import type { ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

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
 */
export default function DoerScoreDialog({
  name,
  scoreLabel,
  scoreColorClass,
  children,
}: {
  name: string;
  scoreLabel: string;
  scoreColorClass: string;
  children: ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger className="rounded font-medium text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
        {name}
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>
            Score: <span className={`font-semibold ${scoreColorClass}`}>{scoreLabel}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] overflow-y-auto">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
