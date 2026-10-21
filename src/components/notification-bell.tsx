"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import { cn } from "@/lib/utils";

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  isRead: boolean;
  createdAt: string;
}

const POLL_INTERVAL_MS = 30_000;

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "abhi";
  if (minutes < 60) return `${minutes}m pehle`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h pehle`;
  const days = Math.floor(hours / 24);
  return `${days}d pehle`;
}

/**
 * A bell icon in the header, next to Settings — the real in-app notification center
 * (roadmap Phase B item #2), structurally separate from `src/components/changelog-menu.tsx`
 * (that one is "what's new in the product" off localStorage; this one is per-user,
 * per-org, backed by `/api/notifications`). Visual pattern (Bell/Badge/DropdownMenu/
 * animate-ping) copied from changelog-menu.tsx so both feel consistent.
 *
 * Polling, not a push channel: a plain `setInterval` inside a `useEffect`, firing a
 * `fetch().then(setState)` promise chain. This project's `react-hooks/set-state-in-effect`
 * lint rule flags calling a named async helper (that itself calls `setState` after an
 * `await`) directly from the effect body — so the poll tick is written as an inline
 * promise chain instead, the same shape `billing-client.tsx`'s own effect already uses,
 * and only the mount-tick + the `setInterval` callback call it, never the effect body
 * synchronously. Verified by actually running `npm run lint`, not assumed.
 */
export default function NotificationBell() {
  const t = useT();
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh() {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = (await res.json()) as { notifications: NotificationItem[]; unreadCount: number };
      setItems(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      // Best-effort — a failed poll just leaves the badge showing its last known count.
    }
  }

  useEffect(() => {
    function poll() {
      fetch("/api/notifications")
        .then((res) => (res.ok ? (res.json() as Promise<{ notifications: NotificationItem[]; unreadCount: number }>) : null))
        .then((data) => {
          if (!data) return;
          setItems(data.notifications);
          setUnreadCount(data.unreadCount);
        })
        .catch(() => {
          // Best-effort — a failed poll just leaves the badge showing its last known count.
        });
    }
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  async function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) await refresh();
  }

  async function markRead(ids: string[]) {
    await fetch("/api/notifications/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
  }

  async function handleItemClick(item: NotificationItem) {
    setOpen(false);
    if (!item.isRead) {
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, isRead: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
      await markRead([item.id]);
    }
    router.push(item.link);
  }

  async function handleMarkAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    await fetch("/api/notifications/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
  }

  return (
    <DropdownMenu open={open} onOpenChange={(next) => void handleOpenChange(next)}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("Notifications")}
            className="relative"
          >
            <Bell />
            {unreadCount > 0 && (
              <>
                <span
                  aria-hidden="true"
                  className="absolute -right-1 -top-1 size-4 animate-ping rounded-full bg-primary/60"
                />
                <Badge
                  variant="default"
                  className="absolute -right-1 -top-1 h-4 min-w-4 justify-center rounded-full px-1 text-[10px] leading-none"
                >
                  {unreadCount > 9 ? "9+" : unreadCount}
                </Badge>
              </>
            )}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex items-center justify-between gap-2">
            <span>{t("Notifications")}</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => void handleMarkAllRead()}
                className="text-xs font-normal text-primary hover:underline"
              >
                {t("Sab read karein")}
              </button>
            )}
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <div className="flex max-h-80 flex-col gap-0.5 overflow-y-auto px-1.5 py-1">
          {items.length === 0 && (
            <p className="px-1.5 py-3 text-center text-xs text-muted-foreground">
              {t("Koi notification nahi hai.")}
            </p>
          )}
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => void handleItemClick(item)}
              className={cn(
                "w-full rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-muted",
                !item.isRead && "bg-primary/5"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  {!item.isRead && (
                    <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
                  )}
                  {t(item.title)}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {relativeTime(item.createdAt)}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{item.body}</p>
            </button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
