"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

/**
 * Shared keyboard/ARIA behavior for a type-to-search combobox (VendorPicker, ItemPicker,
 * FMS's LookupCombobox) — each of those renders its own result list differently (a name, a
 * name+SKU+UOM block, an arbitrary lookup field), so this stays a hook the caller wires
 * into its own <Input>/list markup rather than a single do-everything component.
 *
 * Gives Arrow Up/Down to move a highlighted result, Enter to pick it, and Escape to close
 * the list without closing whatever dialog it's inside (stopPropagation, since a bare
 * Escape bubbling up would also close the parent Dialog).
 *
 * The highlighted index is clamped to the current result count at read-time rather than
 * reset via a ref/effect on every keystroke — this project's lint rules (react-hooks/refs,
 * react-hooks/set-state-in-effect) disallow both patterns, and a pure clamp is simpler
 * anyway: it can never point past the end of a list a keystroke just narrowed.
 */
export function useComboboxNav({
  itemCount,
  open,
  onOpenChange,
  onSelect,
}: {
  itemCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (index: number) => void;
}) {
  const [rawIndex, setRawIndex] = useState(-1);
  const optionRefs = useRef<(HTMLElement | null)[]>([]);

  const activeIndex = itemCount === 0 ? -1 : Math.min(rawIndex, itemCount - 1);

  useEffect(() => {
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        onOpenChange(true);
        return;
      }
      setRawIndex((i) => {
        if (itemCount === 0) return -1;
        const cur = Math.min(i, itemCount - 1);
        return (cur + 1) % itemCount;
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        onOpenChange(true);
        return;
      }
      setRawIndex((i) => {
        if (itemCount === 0) return -1;
        const cur = Math.min(i, itemCount - 1);
        return cur <= 0 ? itemCount - 1 : cur - 1;
      });
    } else if (e.key === "Enter") {
      if (open && activeIndex >= 0) {
        e.preventDefault();
        onSelect(activeIndex);
        setRawIndex(-1);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        onOpenChange(false);
        setRawIndex(-1);
      }
    }
  }

  return { activeIndex, setActiveIndex: setRawIndex, optionRefs, onKeyDown };
}

export function comboboxListId(id: string) {
  return `${id}-listbox`;
}

export function comboboxOptionId(id: string, index: number) {
  return `${id}-option-${index}`;
}
