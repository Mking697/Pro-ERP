import { cn } from "@/lib/utils"

/**
 * A placeholder block that holds the space real content will take.
 *
 * Every board in this app waits on a Google Sheets read, which takes seconds rather than
 * milliseconds. A bare "Loading..." line collapses the page to one row and then shoves
 * everything down when the data lands; a skeleton of roughly the right shape keeps the
 * layout still and tells the reader what is coming.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      // aria-hidden: the loading state is announced once by the region's own
      // aria-busy, not by every bar in the placeholder.
      aria-hidden="true"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
