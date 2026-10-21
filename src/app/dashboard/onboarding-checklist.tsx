"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/preferences-provider";
import type { OnboardingStep } from "@/lib/onboarding";

/**
 * First-run onboarding checklist — see src/lib/onboarding.ts for scope/rationale. Rendered
 * only by the Server Component caller (dashboard page) when `dismissed` is false and the
 * viewer is Admin; this component owns only the dismiss interaction and the step list UI.
 */
export default function OnboardingChecklist({ steps }: { steps: OnboardingStep[] }) {
  const t = useT();
  const router = useRouter();
  const [dismissing, setDismissing] = useState(false);
  const [hidden, setHidden] = useState(false);

  async function handleDismiss() {
    setDismissing(true);
    try {
      const res = await fetch("/api/onboarding/dismiss", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(t(data.error ?? "Dismiss nahi ho paya."));
        return;
      }
      setHidden(true);
      router.refresh();
    } catch {
      toast.error(t("Kuch galat ho gaya. Dobara try karein."));
    } finally {
      setDismissing(false);
    }
  }

  if (hidden) return null;

  const doneCount = steps.filter((s) => s.done).length;

  return (
    <Card className="relative animate-in overflow-hidden fade-in-0 slide-in-from-bottom-2 fill-mode-both duration-500">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ background: "linear-gradient(90deg, var(--primary), color-mix(in oklch, var(--primary), transparent 70%))" }}
      />
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle>{t("Shuru karein")}</CardTitle>
          <CardDescription>
            {t("{done}/{total} steps pure hue — Pro ERP set up karne ke liye yeh steps follow karein.")
              .replace("{done}", String(doneCount))
              .replace("{total}", String(steps.length))}
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleDismiss}
          disabled={dismissing}
          aria-label={t("Checklist band karein")}
        >
          <X />
        </Button>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {steps.map((step, i) => (
          <Link
            key={step.key}
            href={step.href}
            style={{ animationDelay: `${i * 60}ms` }}
            className="animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-both flex items-start gap-3 rounded-lg border p-3 text-sm transition-all duration-150 hover:-translate-y-0.5 hover:border-foreground/30 hover:bg-muted/60 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              aria-hidden="true"
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${
                step.done
                  ? "bg-[color-mix(in_oklch,var(--chart-good),transparent_80%)] text-[var(--chart-good)]"
                  : "border border-muted-foreground/30 text-transparent"
              }`}
            >
              <Check className="size-3.5" />
            </span>
            <div className="min-w-0">
              <p className={`font-medium ${step.done ? "text-muted-foreground line-through" : ""}`}>
                {t(step.label)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t(step.description)}</p>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
