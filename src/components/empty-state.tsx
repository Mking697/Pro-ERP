import { cn } from "@/lib/utils";

/**
 * What a list shows when it has nothing in it.
 *
 * Nine of these were written by hand, with three different paddings between them. Beyond
 * the consistency, an empty list is the one moment a person is guaranteed to be looking
 * for what to do next — so this always has room for the action that fills it, rather than
 * being a dead end that says "no data".
 */
export default function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  /** An already-rendered icon element, so this works from server and client alike. */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-12 text-center",
        className
      )}
    >
      {icon && (
        <div
          aria-hidden="true"
          className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary ring-1 ring-primary/10 [&_svg]:size-5.5"
        >
          {icon}
        </div>
      )}
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-pretty text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
