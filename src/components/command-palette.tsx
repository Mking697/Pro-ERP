"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, Building2, Handshake, Package, ShoppingCart, UserRoundSearch } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useT } from "@/components/preferences-provider";
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

/** Each result kind gets its own icon-badge color — the same "distinct identity per
 * category" reasoning as the dashboard's StatCard accents — so a mixed result list
 * scans faster than one where every row's icon is the same muted gray. */
const KIND_ACCENT: Record<SearchResult["kind"], string> = {
  customer: "var(--chart-series-1)",
  vendor: "var(--chart-series-2)",
  order: "var(--chart-good)",
  item: "var(--chart-warning)",
  lead: "var(--primary)",
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
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const cancelSearch = useCallback(() => {
    requestRef.current++;
    controllerRef.current?.abort();
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);
  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) {
      cancelSearch();
      setQuery(""); setResults([]); setActiveIndex(0); setLoading(false);
      setPage(0); setHasMore(false); setError(null);
    }
  }, [cancelSearch]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        handleOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, handleOpenChange]);

  useEffect(() => {
    // Base UI's Dialog focuses its own Popup on open; stealing focus back to the input
    // one frame later is the usual pattern for an in-dialog search box. No setState call
    // here (only .focus()), so this one effect is exempt from the sync-setState rule.
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 2) return;
    const requestId = requestRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    const current = () => !controller.signal.aborted && requestId === requestRef.current;
    debounceRef.current = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query.trim())}&page=${page}`, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`${t("Search failed. Please retry.")} (HTTP ${res.status})`);
          return res.json();
        })
        .then((data: { results: SearchResult[]; hasMore?: boolean }) => {
          if (!current()) return;
          setResults(data.results ?? []); setHasMore(!!data.hasMore); setActiveIndex(0); setError(null);
        })
        .catch(() => {
          if (!current()) return;
          setError(t("Search failed. Please retry."));
        })
        .finally(() => { if (current()) setLoading(false); });
    }, 250);
    return () => {
      controller.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, open, page, retryKey, t]);

  function handleQueryChange(value: string) {
    cancelSearch(); setQuery(value); setPage(0); setHasMore(false); setError(null);
    setResults([]); setActiveIndex(0); setLoading(value.trim().length >= 2);
  }
  function changePage(next: number) {
    cancelSearch(); setPage(next); setResults([]); setActiveIndex(0); setLoading(true); setError(null);
  }

  const goTo = useCallback(
    (result: SearchResult) => {
      handleOpenChange(false);
      router.push(result.href);
    },
    [router, handleOpenChange]
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
          className="top-[12%] max-w-lg translate-y-0 gap-0 overflow-hidden p-0 shadow-xl"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Global Search</DialogTitle>
          <div className="flex items-center gap-2 border-b bg-muted/30 px-3.5 py-3">
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

          {error && <div role="alert" className="px-3 py-2 text-sm text-destructive">{error} <button type="button" aria-label={t("Retry search")} onClick={() => { cancelSearch(); setLoading(true); setError(null); setRetryKey(key => key + 1); }}>{t("Retry search")}</button></div>}
          <div
            id="command-palette-results"
            role="listbox"
            className="max-h-80 overflow-y-auto p-1.5"
          >
            {query.trim().length >= 2 && !loading && !error && results.length === 0 && (
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
              const accent = KIND_ACCENT[result.kind];
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
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors duration-100",
                    active ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="flex size-7 shrink-0 items-center justify-center rounded-md"
                    style={{
                      background: `color-mix(in oklch, ${accent}, transparent 85%)`,
                      color: accent,
                    }}
                  >
                    <Icon className="size-3.5" />
                  </span>
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

          {(page > 0 || hasMore) && (
            <div className="flex justify-between border-t px-3 py-2">
              <button type="button" aria-label={t("Previous search page")} disabled={loading || page === 0} onClick={() => changePage(page - 1)}>{t("Previous")}</button>
              <span>{t("Page")} {page + 1}</span>
              <button type="button" aria-label={t("Next search page")} disabled={loading || !hasMore} onClick={() => changePage(page + 1)}>{t("Next")}</button>
            </div>
          )}
          {/* Keyboard affordance footer — a small, unobtrusive reminder of the arrow
              keys/Enter/Esc shortcuts the palette already supports, so first-time users
              don't have to discover them by accident. */}
          <div className="flex items-center gap-3 border-t bg-muted/20 px-3.5 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-background px-1 py-0.5 font-mono">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-background px-1 py-0.5 font-mono">↵</kbd>
              open
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-background px-1 py-0.5 font-mono">esc</kbd>
              close
            </span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
