"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useT } from "@/components/preferences-provider";

/**
 * One reusable camera scanner for every SKU-scan integration in the app (Inventory,
 * Dispatch, Purchase General PO Receive). There is no separate barcode field anywhere
 * in the schema — the decoded text IS the SKU — so this component only ever hands the
 * raw decoded string back via `onScan`; matching it to a real row is the caller's job
 * (see src/lib/scan/match.ts).
 *
 * Uses @zxing/browser (pure JS, works on mobile Safari/Chrome, no native
 * BarcodeDetector dependency — that API has no Firefox/Safari support at all).
 * The zxing reader is dynamically imported so this file only touches `navigator`/
 * `document.createElement("video")` once it is actually opened on the client — the
 * import itself is still safe at module scope since @zxing/browser does no top-level
 * camera access, but dynamic import keeps the heavy decode library out of every other
 * page's bundle until a Scan button is actually clicked.
 */
export default function BarcodeScanButton({
  onScan,
  label,
  variant = "outline",
  size = "sm",
}: {
  onScan: (value: string) => void;
  /** Button label override — defaults to a Hinglish "Scan" caption. */
  label?: string;
  variant?: "outline" | "default" | "secondary" | "ghost";
  size?: "sm" | "default" | "icon" | "icon-sm";
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // `any`-free: the concrete type lives in @zxing/browser, imported only at runtime.
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const doneRef = useRef(false);

  function stopCamera() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    // BrowserMultiFormatReader's own stop() already stops the tracks it opened, but a
    // decode that fails before controls exist can still leave a getUserMedia stream
    // open — stopping every track here too is what actually guarantees the camera
    // light turns off, belt-and-braces against that race.
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    if (!open) return;
    doneRef.current = false;

    let cancelled = false;
    (async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader();
        const videoEl = videoRef.current;
        if (!videoEl) return;
        const controls = await reader.decodeFromVideoDevice(
          undefined,
          videoEl,
          (result, err) => {
            if (doneRef.current) return;
            if (result) {
              doneRef.current = true;
              const text = result.getText();
              stopCamera();
              setOpen(false);
              onScan(text);
              return;
            }
            // NotFoundException fires continuously while no code is in frame yet —
            // that is the expected steady state while scanning, not a real error.
            if (err && err.name !== "NotFoundException") {
              // Swallow per-frame decode noise; a hard camera failure instead throws
              // out of decodeFromVideoDevice itself and is handled in the catch below.
            }
          }
        );
        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        streamRef.current = (videoEl.srcObject as MediaStream | null) ?? null;
        setStarting(false);
      } catch (err) {
        if (cancelled) return;
        setStarting(false);
        const name = err instanceof Error ? err.name : "";
        const message =
          name === "NotAllowedError"
            ? t("Camera ki permission nahi mili. Browser settings me camera allow karein.")
            : name === "NotFoundError"
              ? t("Is device par koi camera nahi mila.")
              : t("Camera start nahi ho paya.");
        setErrorMsg(message);
        toast.error(message);
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => {
          setErrorMsg("");
          setStarting(true);
          setOpen(true);
        }}
      >
        <ScanLine />
        {label ?? t("Scan")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) stopCamera();
          setOpen(v);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Barcode / QR Scan Karein")}</DialogTitle>
            <DialogDescription>
              {t("SKU label ko camera ke saamne rakhein — pehla code detect hote hi apne aap band ho jaayega.")}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-hidden rounded-lg bg-black">
            {/* Always mounted while the dialog is open, even during an error — keeps
                the ref stable for the effect above and simply sits behind the error
                message/overlay when the camera never starts. */}
            <video
              ref={videoRef}
              className="aspect-video w-full object-cover"
              muted
              playsInline
            />
          </div>
          {starting && !errorMsg && (
            <p className="text-sm text-muted-foreground">{t("Camera start ho raha hai...")}</p>
          )}
          {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
        </DialogContent>
      </Dialog>
    </>
  );
}
