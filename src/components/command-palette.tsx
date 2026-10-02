"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, Building2, Handshake, Package, ShoppingCart, UserRoundSearch } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { SearchResult } from "@/app/api/search/route";

const KIND_ICON: Record<SearchResult["kind"], typeof Search> = {
  customer: Building2,
  vendor: Handshake,
  order: ShoppingCart,
  item: Package,
  lead: UserRoundSearch,
};

const KIND_LABEL: Record<SearchResult["kind"], string> = {
  customer: "Customer",
  vendor: "Vendor",
  order: "Order",
  item: "Item",
  lead: "Lead",
};

/**
 * Global search / command-palette (Cmd+K or Ctrl+K) — searches Customers, Vendors,
 * Orders, Items, and Leads across modules from anywhere in the app.
 *
 * Deliberately a hand-built Dialog + fetch, not a new dependency (`cmdk` etc.) — this
 * project's own convention (see CLAUDE.md on base-ui vs 21st.dev) is to build on the
 * primitives already here rather than add a second UI library for one feature.
 */
export default function CommandPalette({ iconOnly = false }: { iconOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    // Base UI's Dialog focuses its own Popup on open; stealing focus back to the input
    // one frame later is the usual pattern for an in-dialog search box. No setState call
    // here (only .focus()), so this one effect is exempt from the sync-setState rule.
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  // Resetting query/results/activeIndex happens here, at the one place that actually
  // closes the dialog (Escape, outside click, or a real navigation), rather than
  // synchronously inside a useEffect watching `open` — this project's lint config
  // (react-hooks/set-state-in-effect) disallows the latter.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQuery("");
      setResults([]);
      setActiveIndex(0);
    }
  }

  // Likewise, the <2-char "nothing to search yet" reset and the loading flag both happen
  // directly in the input's onChange (handleQueryChange below), not synchronously inside
  // this effect — the effect only ever starts/cancels the debounced fetch, whose own
  // setState calls are all inside .then()/.catch()/.finally(), which the rule allows.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) return;
    debounceRef.current = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query.trim())}`)
        .then((res) => res.json())
        .then((data: { results: SearchResult[] }) => {
          setResults(data.results ?? []);
          setActiveIndex(0);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      setLoading(false);
    } else {
      setLoading(true);
    }
  }

  const goTo = useCallback(
    (result: SearchResult) => {
      handleOpenChange(false);
      router.push(result.href);
    },
    [router]
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = results[Math.min(activeIndex, results.length - 1)];
      if (picked) goTo(picked);
    }
  }

  return (
    <>
      {iconOnly ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Global search kholen"
        >
          <Search aria-hidden="true" className="size-5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2 rounded-xl border bg-background px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Global search kholen"
        >
          <Search aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">Search...</span>
          <kbd className="hidden shrink-0 rounded border bg-muted px-1 py-0.5 font-mono text-[10px] sm:inline-block">
            ⌘K
          </kbd>
        </button>
      )}

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="top-[12%] max-w-lg translate-y-0 gap-0 p-0"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Global Search</DialogTitle>
          <div className="flex items-center gap-2 border-b px-3.5 py-3">
            <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Customer, order, SKU ya lead dhoondhein..."
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              aria-label="Search"
              role="combobox"
              aria-expanded={results.length > 0}
              aria-controls="command-palette-results"
              aria-activedescendant={
                results.length > 0 ? `command-palette-option-${activeIndex}` : undefined
              }
              aria-autocomplete="list"
            />
            {loading && <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin text-muted-foreground" />}
          </div>

          <div
            id="command-palette-results"
            role="listbox"
            className="max-h-80 overflow-y-auto p-1.5"
          >
            {query.trim().length >= 2 && !loading && results.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Kuch nahi mila &quot;{query}&quot; ke liye.
              </p>
            )}
            {query.trim().length < 2 && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Customer, vendor, order, item SKU ya lead ka naam type karein.
              </p>
            )}
            {results.map((result, index) => {
              const Icon = KIND_ICON[result.kind];
              const active = index === activeIndex;
              return (
                <button
                  key={`${result.kind}-${result.id}`}
                  id={`command-palette-option-${index}`}
                  role="option"
                  aria-selected={active}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => goTo(result)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm",
                    active ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                  )}
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{result.title}</span>
                  <span className="shrink-0 truncate text-xs text-muted-foreground">
                    {result.subtitle}
                  </span>
                  <span className="shrink-0 rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {KIND_LABEL[result.kind]}
                  </span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
