"use client";

import { useSyncExternalStore } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useT } from "@/components/preferences-provider";
import { CHANGELOG } from "@/lib/changelog";

const SEEN_KEY = "pro-erp-changelog-last-seen";

/**
 * A tiny external store instead of `useState`+`useEffect`: localStorage has no React state
 * of its own, and writing it from a click handler still has to notify this component (a
 * `storage` event only fires in *other* tabs, never the one that wrote it) — so the store
 * tracks its own listeners. This also sidesteps the SSR/hydration mismatch `useState` would
 * have here, since `useSyncExternalStore`'s server snapshot is used for the first render.
 */
let cachedSeen: string | null | undefined;
const listeners = new Set<() => void>();

function readLastSeen(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    // Private window / blocked storage: behave as if nothing has ever been seen.
    return null;
  }
}

function getSnapshot(): string | null | undefined {
  if (cachedSeen === undefined) cachedSeen = readLastSeen();
  return cachedSeen;
}

function getServerSnapshot(): string | null | undefined {
  return undefined;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function markSeen(id: string) {
  cachedSeen = id;
  try {
    window.localStorage.setItem(SEEN_KEY, id);
  } catch {
    // Same as above — worst case the badge just reappears next visit, not a correctness bug.
  }
  for (const listener of listeners) listener();
}

/**
 * A bell icon in the header, next to Settings, for the one-line "what's new since you last
 * looked" surface — every feature this session shipped with no in-product announcement.
 *
 * "Seen" lives in localStorage, not a database column: this is a nice-to-have, and adding a
 * per-user column for it would break this project's own rule that schema changes go through
 * the session driver, not a subagent in passing. Worst case a badge reappears on another
 * device — an acceptable tradeoff, not a correctness issue.
 */
export default function ChangelogMenu() {
  const t = useT();
  const lastSeen = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // `undefined` is the SSR/not-yet-hydrated snapshot; render "no badge" until the real,
  // client-only value arrives, same as the server did, so hydration never mismatches.
  const seenIndex = lastSeen === undefined ? -2 : CHANGELOG.findIndex((entry) => entry.id === lastSeen);
  // -1 (marker matches nothing — first-ever visit, or localStorage cleared) means every
  // entry is unseen; -2 (not hydrated yet) means show nothing yet.
  const unseenCount = seenIndex === -2 ? 0 : seenIndex === -1 ? CHANGELOG.length : seenIndex;

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) markSeen(CHANGELOG[0].id);
      }}
    >
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Naye updates")}
            className="relative"
          >
            <Bell />
            {unseenCount > 0 && (
              <Badge
                variant="default"
                className="absolute -right-1 -top-1 h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none"
              >
                {unseenCount > 9 ? "9+" : unseenCount}
              </Badge>
            )}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-80">
        {/* GroupLabel requires a Group ancestor (Base UI error #31 otherwise) — every
            other DropdownMenuLabel usage in this codebase (settings-menu.tsx) already
            wraps it; this one didn't, which crashed the whole page on open. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("Naye updates")}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto px-1.5 py-1">
          {CHANGELOG.map((entry) => (
            <div key={entry.id} className="rounded-md px-1.5 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{t(entry.title)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{entry.date}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{t(entry.description)}</p>
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
