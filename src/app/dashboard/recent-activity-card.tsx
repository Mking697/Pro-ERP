import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDueDisplay } from "@/lib/formatDate";
import { listRecentActivity } from "@/lib/activityFeed";
import type { Translator } from "@/lib/i18n";

const MODULE_DOT: Record<string, string> = {
  leads: "bg-[var(--chart-series-1)]",
  orders: "bg-[var(--chart-series-2)]",
  pdi: "bg-[var(--chart-series-3)]",
  tms: "bg-[var(--chart-warning)]",
  dispatch: "bg-[var(--chart-good)]",
};

/**
 * Home-page "what just happened" feed — merges every pipeline leg's own append-only
 * activity trail (Lead/Order/PDI/TMS/Dispatch) into one newest-first list, scoped to
 * whatever the viewer actually holds a grant for. See src/lib/activityFeed.ts for which
 * modules feed this and why some (Inward/IQC, Inventory) don't have an entry yet.
 */
export default async function RecentActivityCard({
  access,
  t,
}: {
  access: readonly string[];
  t: Translator;
}) {
  const entries = await listRecentActivity(access, 12);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t("Recent Activity")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {entries.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("Abhi koi activity nahi hai.")}
          </p>
        )}
        {entries.map((entry, i) => (
          <Link
            key={entry.id}
            href={entry.href}
            style={{ animationDelay: `${i * 40}ms` }}
            className="flex animate-in items-start gap-3 rounded-lg p-2 text-sm fade-in-0 slide-in-from-bottom-1 fill-mode-both duration-500 hover:bg-muted/50"
          >
            <span
              aria-hidden="true"
              className={`mt-1.5 size-2 shrink-0 rounded-full ${MODULE_DOT[entry.module] ?? "bg-muted-foreground"}`}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate">
                <span className="font-medium">{entry.moduleLabel}</span> — {entry.message}
                {entry.actorName && (
                  <span className="text-muted-foreground"> ({entry.actorName})</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">{formatDueDisplay(entry.createdAt)}</p>
            </div>
          </Link>
        ))}
        {entries.length > 0 && (
          <Button variant="outline" size="sm" className="mt-2" render={<Link href="/reports">{t("Saari reports dekhein")}</Link>} />
        )}
      </CardContent>
    </Card>
  );
}
