"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/preferences-provider";

export interface FieldCustomerOption {
  id: string;
  name: string;
  phone: string;
  city: string;
  state: string;
}

/** Single-select Customer Master picker shared by Services/Complaints/Site Visits —
 * unlike Order FMS's own Existing/New tabs, this app's answer for field service is
 * dropdown-only against the existing Customer Master (no inline "add new customer"
 * here — that stays Parties' own job). */
export default function CustomerSelect({
  selectedId,
  onSelect,
}: {
  selectedId: string;
  onSelect: (customer: FieldCustomerOption) => void;
}) {
  const t = useT();
  const [customers, setCustomers] = useState<FieldCustomerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [version, setVersion] = useState(0);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/field-service/customers-lookup", { signal: controller.signal, cache: "no-store" })
      .then(async (res) => { if (!res.ok) throw new Error(); return res.json(); })
      .then((data: { customers?: FieldCustomerOption[] }) => {
        if (!controller.signal.aborted) { setCustomers(data.customers ?? []); setError(false); }
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [version]);

  const matches = customers.filter((c) =>
    `${c.name} ${c.phone}`.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <div className="space-y-2">
      <Input
        aria-label={t("Customer")}
        placeholder={t("Customer naam ya phone se search karein...")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />
      <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border p-1">
        {error ? (
          <div role="alert" className="space-y-2 p-2 text-sm">
            <p>{t("Customers load nahi ho paye.")}</p>
            <Button variant="outline" size="sm" onClick={() => { setError(false); setLoading(true); setVersion((v) => v + 1); }}>{t("Retry")}</Button>
          </div>
        ) : loading ? (
          <p className="p-2 text-sm text-muted-foreground">{t("Load ho raha hai...")}</p>
        ) : matches.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">
            {t("Koi customer nahi mila — pehle Vendors/Customers me punch karein.")}
          </p>
        ) : (
          matches.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-pressed={selectedId === c.id}
              onClick={() => onSelect(c)}
              className={`w-full rounded-md border p-2 text-left text-sm transition-colors duration-150 hover:bg-muted ${
                selectedId === c.id ? "border-primary bg-muted" : ""
              }`}
            >
              <span className="block font-medium">{c.name}</span>
              <span className="block text-xs text-muted-foreground">
                {[c.phone, c.city].filter(Boolean).join(" · ") || "—"}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
