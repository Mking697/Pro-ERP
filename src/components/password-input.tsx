"use client";

import { useId, useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Password field with a show/hide toggle.
 *
 * Typing a password blind is the single most common cause of a failed login, and the
 * cost of a mistyped password is highest exactly where it is hardest to notice — on
 * signup, where it is also the confirm-free first entry.
 */
export default function PasswordInput({
  className,
  id,
  ...props
}: ComponentProps<typeof Input>) {
  const [visible, setVisible] = useState(false);
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className="relative">
      <Input
        {...props}
        id={inputId}
        type={visible ? "text" : "password"}
        className={cn("pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        // Not a submit button, and never in the tab order ahead of the field itself.
        aria-label={visible ? "Password chhupayein" : "Password dikhayein"}
        aria-pressed={visible}
        aria-controls={inputId}
        className={cn(
          "absolute inset-y-0 right-0 flex w-10 items-center justify-center",
          "text-muted-foreground transition-colors hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "focus-visible:ring-offset-1 rounded-md cursor-pointer"
        )}
      >
        {visible ? (
          <EyeOff className="size-4" aria-hidden="true" />
        ) : (
          <Eye className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
