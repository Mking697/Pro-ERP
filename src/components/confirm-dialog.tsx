"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Asks before an action that is hard to take back.
 *
 * The bar for using this is not "is it a delete" but "would the person be upset if this
 * happened by accident". Suspending an organization logs out everybody in it; cancelling
 * a production plan hands its reserved material to whoever asks next. Both are one click
 * away and neither announces itself, so both are worth a question.
 *
 * Deliberately not used for reversible toggles — a confirmation on every switch trains
 * people to click through confirmations without reading them, which is worse than none.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Haan, karein",
  cancelLabel = "Rehne dein",
  destructive = true,
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Say what will actually happen, in the reader's terms — not "are you sure?". */
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          {/* Cancel first, and it is the plain button: the safe way out should be the
              one the hand reaches for without aiming. */}
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Ho raha hai..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface PendingConfirm {
  title: string;
  description: string;
  confirmLabel?: string;
  /** Return value is ignored — callers often reuse an action that reports success. */
  onConfirm: () => unknown;
}

/**
 * Holds the "which action is waiting to be confirmed" state, so a board with several
 * confirmable rows does not need one piece of state per row.
 */
export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!pending) return;
    setBusy(true);
    try {
      await pending.onConfirm();
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  return {
    /** Call with what should happen if the person says yes. */
    ask: setPending,
    dialog: (
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && !busy && setPending(null)}
        title={pending?.title ?? ""}
        description={pending?.description ?? ""}
        confirmLabel={pending?.confirmLabel}
        busy={busy}
        onConfirm={run}
      />
    ),
  };
}
