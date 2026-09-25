"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/preferences-provider";
import { useComboboxNav, comboboxListId, comboboxOptionId } from "@/components/ui/combobox";

export interface VendorOption {
  id: string;
  name: string;
}

/**
 * Type-to-search Party Name field, backed by Vendor Master.
 *
 * Unlike ItemPicker, picking a vendor is not required: an inward entry can still name a
 * party that isn't in Vendor Master yet, so this stays a free-text field that only carries
 * a `vendorId` alongside it once the typed name has actually been matched to a real vendor
 * — Party_Name itself is never blocked on a match existing.
 */
export default function VendorPicker({
  name,
  vendorId,
  onChange,
  required = false,
}: {
  name: string;
  vendorId: string;
  onChange: (name: string, vendorId: string) => void;
  required?: boolean;
}) {
  const t = useT();
  const inputId = useId();
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/parties/vendors/lookup")
      .then((res) => res.json())
      .then((data: { vendors?: VendorOption[] }) => setVendors(data.vendors ?? []))
      .catch(() => setVendors([]));
  }, []);

  const matches = useMemo(() => {
    const q = name.trim().toLowerCase();
    if (!q) return vendors.slice(0, 8);

    return vendors
      .map((v) => ({ vendor: v, at: v.name.toLowerCase().indexOf(q) }))
      .filter((m) => m.at !== -1)
      .sort((a, b) => a.at - b.at)
      .slice(0, 8)
      .map((m) => m.vendor);
  }, [vendors, name]);

  const { activeIndex, optionRefs, onKeyDown } = useComboboxNav({
    itemCount: matches.length,
    open,
    onOpenChange: setOpen,
    onSelect: (index) => {
      const vendor = matches[index];
      if (!vendor) return;
      onChange(vendor.name, vendor.id);
      setOpen(false);
    },
  });

  if (vendorId) {
    const vendor = vendors.find((v) => v.id === vendorId);
    return (
      <div className="space-y-2">
        <span className="block text-sm font-medium">Party Name</span>
        <div className="flex items-center gap-2 rounded-lg border p-2.5 text-sm">
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{vendor?.name ?? name}</span>
            <span className="block text-xs text-muted-foreground">
              {t("Vendor Master se linked hai.")}
            </span>
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange("", "")}>
            {t("Badlein")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>Party Name</Label>
      <div className="relative">
        <Input
          id={inputId}
          value={name}
          onChange={(e) => {
            onChange(e.target.value, "");
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t("Naam type karein, vendor list se chunein ya naya likhein")}
          required={required}
          autoComplete="off"
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls={comboboxListId(inputId)}
          aria-activedescendant={activeIndex >= 0 ? comboboxOptionId(inputId, activeIndex) : undefined}
          aria-autocomplete="list"
        />

        {open && matches.length > 0 && (
          <ul
            id={comboboxListId(inputId)}
            role="listbox"
            className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-md"
          >
            {matches.map((vendor, index) => (
              <li key={vendor.id}>
                <button
                  ref={(el) => {
                    optionRefs.current[index] = el;
                  }}
                  id={comboboxOptionId(inputId, index)}
                  role="option"
                  aria-selected={index === activeIndex}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(vendor.name, vendor.id);
                    setOpen(false);
                  }}
                  className={`w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors duration-150 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none ${
                    index === activeIndex ? "bg-muted" : ""
                  }`}
                >
                  {vendor.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
