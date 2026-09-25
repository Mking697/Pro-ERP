import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Scale and translate ride on CSS's separate `scale`/`translate` properties (not a
  // shared `transform` shorthand), so the hover lift and the existing active press-down
  // never fight over one property — both apply at once with no override ambiguity.
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all duration-150 outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 not-disabled:hover:scale-[1.02] active:not-aria-[haspopup]:translate-y-px not-disabled:active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/80 hover:shadow-md",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground hover:shadow-sm aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] hover:shadow-sm aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        // Visual size stays small (dense tables rely on this), but on a touch device
        // (pointer: coarse — a mouse never matches this) each icon button also grows an
        // invisible ::before hit-area out to ~44px, the mobile tap-target guideline. The
        // inset is sized per variant so every one lands on the same ~44px total, and is
        // capped small enough that it only ever eats into a button's own surrounding
        // padding/gap, never crossing into a neighboring control's own box.
        icon: "relative size-8 pointer-coarse:before:absolute pointer-coarse:before:inset-[-6px] pointer-coarse:before:content-['']",
        "icon-xs":
          "relative size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3 pointer-coarse:before:absolute pointer-coarse:before:inset-[-10px] pointer-coarse:before:content-['']",
        "icon-sm":
          "relative size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg pointer-coarse:before:absolute pointer-coarse:before:inset-[-8px] pointer-coarse:before:content-['']",
        "icon-lg": "relative size-9 pointer-coarse:before:absolute pointer-coarse:before:inset-[-4px] pointer-coarse:before:content-['']",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
