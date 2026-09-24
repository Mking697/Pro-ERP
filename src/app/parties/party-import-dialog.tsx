"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/components/preferences-provider";

interface ImportError {
  row: number;
  message: string;
}

interface ImportResult {
  created: number;
  errors: ImportError[];
  /** Rows created despite matching a name already in the sheet, or repeated within the
   * same file — not blocked, just flagged, same as the manual-add dialog's toast. */
  warnings: ImportError[];
}

/**
 * Bulk Upload for Vendor/Customer — download a CSV template, fill it in Excel, upload it
 * back. Vendors and Customers share this one component rather than each growing its own
 * copy, since the only difference between them is which URLs and labels are used — mirrors
 * `src/app/inventory/bulk-import-dialog.tsx` (Items), which is left untouched since its
 * import path already works in production.
 */
export default function PartyImportDialog({
  entityLabel,
  templateUrl,
  importUrl,
  onImported,
}: {
  /** e.g. "Vendor" / "Customer" — used in the dialog title and result copy. */
  entityLabel: string;
  templateUrl: string;
  importUrl: string;
  onImported: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleImport() {
    if (!file) return;
    setImporting(true);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(importUrl, { method: "POST", body: formData });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        toast.error(t(data?.error ?? "Import nahi ho paya."));
        return;
      }

      const created: number = data.created ?? 0;
      const errors: ImportError[] = data.errors ?? [];
      const warnings: ImportError[] = data.warnings ?? [];
      setResult({ created, errors, warnings });

      if (created > 0) {
        toast.success(`${created} ${entityLabel.toLowerCase()} ban gaye.`);
        onImported();
      }
    } catch {
      toast.error(t("Import nahi ho paya."));
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm">{t("Bulk Upload")}</Button>} />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Bulk Upload")} — {entityLabel}</DialogTitle>
          <DialogDescription>
            {t(
              "Template download karein, usi format me apna data bharein, phir upload karein — sab ek baar me ban jaayenge."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            render={
              <a href={templateUrl} download>
                <Download className="size-4" />
                {t("Template Download karein")}
              </a>
            }
          />

          <div className="space-y-2">
            <Label htmlFor="import-file">{t("Filled-in file (CSV ya Excel)")}</Label>
            <Input
              id="import-file"
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setResult(null);
              }}
              disabled={importing}
            />
          </div>

          {result && (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <p>
                <strong className="text-foreground">{result.created}</strong>{" "}
                {entityLabel.toLowerCase()} {t("ban gaye")}
                {result.errors.length > 0 && (
                  <>
                    , <strong className="text-destructive">{result.errors.length}</strong>{" "}
                    {t("row skip ho gayi(n) errors ki wajah se")}
                  </>
                )}
                {result.warnings.length > 0 && (
                  <>
                    , <strong className="text-amber-700 dark:text-amber-400">{result.warnings.length}</strong>{" "}
                    {t("duplicate naam ke saath ban gaye")}
                  </>
                )}
                .
              </p>
              {result.errors.length > 0 && (
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      Row {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
              {result.warnings.length > 0 && (
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-amber-700 dark:text-amber-400">
                  {result.warnings.map((w, i) => (
                    <li key={i}>
                      Row {w.row}: {w.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleImport} disabled={!file || importing}>
            {importing ? "Importing..." : t("Import karein")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
