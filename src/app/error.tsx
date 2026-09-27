"use client";

import { useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/preferences-provider";

/**
 * Root error boundary (none existed before this) — catches anything an uncaught page/
 * Server Component throws below the root layout. A real bug is already captured
 * server-side by src/instrumentation.ts's `onRequestError` regardless of whether this
 * boundary is ever hit; this is purely the visitor-facing fallback.
 *
 * Special-cases the two `TenantResolutionError` digests (src/lib/tenant.ts) into a
 * friendly, actionable card instead of a generic "something went wrong": a trial-expired
 * Trial org and a Suspended org are both real, expected states a viewer can hit on any
 * page that reads real tenant data (any call into getTenant()/getTenantOrgId()) — not a
 * bug. This is deliberately NOT a fix for every one of the ~30 `page.tsx` files that call
 * `verifySession()` directly without ever touching tenant data (a page that never reads
 * real data never throws here) — see CLAUDE.md's own note on this being a real
 * improvement over the prior no-boundary state, not a complete rewire.
 *
 * `retry` (not `reset`) is this Next version's own prop name for the file convention — see
 * node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md.
 */
export default function RootErrorBoundary({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useT();

  useEffect(() => {
    console.error(error);
  }, [error]);

  if (error.digest === "TRIAL_EXPIRED") {
    return (
      <ErrorCard
        title={t("Trial khatm ho gaya")}
        description={t(
          "Aapke organization ka 14-din trial khatm ho chuka hai. Jaari rakhne ke liye apne Admin se plan upgrade karwayein."
        )}
        onRetry={retry}
      />
    );
  }

  if (error.digest === "ORG_SUSPENDED") {
    return (
      <ErrorCard
        title={t("Organization suspended hai")}
        description={t(
          "Aapka organization abhi suspended hai. Madad ke liye apne Admin ya Pro ERP se sampark karein."
        )}
        onRetry={retry}
      />
    );
  }

  return (
    <ErrorCard
      title={t("Kuch galat ho gaya")}
      description={t("Ek anjaan error aa gaya. Dobara koshish karein ya thodi der baad wapas aayein.")}
      onRetry={retry}
    />
  );
}

function ErrorCard({
  title,
  description,
  onRetry,
}: {
  title: string;
  description: string;
  onRetry: () => void;
}) {
  const t = useT();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={onRetry}>{t("Dobara koshish karein")}</Button>
        </CardContent>
      </Card>
    </div>
  );
}
