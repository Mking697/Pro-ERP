"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * A plain text input with a suggestions dropdown underneath it, built on the same
 * click-outside-to-close pattern as FMS's LookupCombobox (src/app/fms/complete-step-dialog.tsx)
 * — but for a free-text field with no fixed set of valid values (a UOM or a Size/Unit is
 * never restricted to a fixed list the way Category is), so typing anything new is always
 * accepted. The list is just what's already been typed elsewhere, to save retyping "PCS"
 * or "8x40mm" from scratch every time.
 */
export default function AutocompleteInput({
  id,
  value,
  onChange,
  options,
  placeholder,
  required,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const filtered = options.filter((o) => o.toLowerCase().includes(value.trim().toLowerCase()));

  return (
    <div ref={containerRef} className="relative">
      <Input
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
        required={required}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md">
          {filtered.map((option) => (
            <button
              key={option}
              type="button"
              className="block w-full px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                onChange(option);
                setOpen(false);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
