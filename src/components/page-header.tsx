/**
 * The title block every signed-in page opens with.
 *
 * Thirteen pages had hand-written copies of this markup, which is how the spacing under a
 * heading ends up different on three of them. Actions belong in `children`, so a page's
 * primary button sits on the title line instead of floating somewhere below it.
 */
export default function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  /** Actions, rendered to the right of the title on wide screens. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description && (
          // Capped measure: a description running the full width of a 1280px screen is
          // hard to track back to the start of the next line.
          <p className="mt-1 max-w-2xl text-sm text-pretty text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {children && <div className="flex shrink-0 flex-wrap gap-2">{children}</div>}
    </div>
  );
}
