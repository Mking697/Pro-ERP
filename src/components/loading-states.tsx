import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shaped loading placeholders, one per layout this app actually uses.
 *
 * Kept together so every board waits in the same visual language. Each one is wrapped in
 * a live region marked `aria-busy`, so a screen reader hears "loading" once instead of
 * either silence or a stream of meaningless bars.
 */

function Waiting({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** A table: header strip plus rows. */
export function TableSkeleton({
  rows = 5,
  columns = 4,
  label = "Data load ho raha hai",
}: {
  rows?: number;
  columns?: number;
  label?: string;
}) {
  return (
    <Waiting label={label}>
      <div className="overflow-hidden rounded-lg border">
        <div className="flex gap-4 border-b bg-muted/40 px-4 py-3">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className="h-4 flex-1" />
          ))}
        </div>
        <div className="divide-y">
          {Array.from({ length: rows }).map((_, r) => (
            <div key={r} className="flex items-center gap-4 px-4 py-3.5">
              {Array.from({ length: columns }).map((_, c) => (
                <Skeleton
                  key={c}
                  // The first column is usually a name and the rest are numbers, so the
                  // placeholder leans the same way the real row will.
                  className={c === 0 ? "h-4 flex-[1.6]" : "h-4 flex-1"}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </Waiting>
  );
}

/** A stack of cards, as used by the task, BOM and plan boards. */
export function CardListSkeleton({
  count = 3,
  label = "List load ho rahi hai",
}: {
  count?: number;
  label?: string;
}) {
  return (
    <Waiting label={label}>
      <div className="space-y-3">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="rounded-xl border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-8 w-20 rounded-md" />
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </Waiting>
  );
}

/** A settings form: a few labelled fields and a save button. */
export function FormSkeleton({
  fields = 3,
  label = "Settings load ho rahi hain",
}: {
  fields?: number;
  label?: string;
}) {
  return (
    <Waiting label={label}>
      <div className="space-y-4">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        ))}
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>
    </Waiting>
  );
}
