"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore } from "react";
import { Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import NavLinks, { type NavEntry } from "@/components/nav-links";
import CommandPalette from "@/components/command-palette";
import LogoutButton from "@/app/dashboard/logout-button";
import { OrgLogo } from "@/components/logo-picker";
import SettingsMenu from "@/components/settings-menu";
import ChangelogMenu from "@/components/changelog-menu";
import ChatWidget from "@/components/chat-widget";

const COLLAPSE_KEY = "pro-erp:sidebar-collapsed";

/**
 * A tiny external store, the same shape `changelog-menu.tsx` already uses, instead of
 * `useState`+`useEffect`: this project's lint config (`react-hooks/set-state-in-effect`)
 * rejects calling `setState` synchronously inside an effect body, which is exactly what
 * "read localStorage after mount" would otherwise be. `useSyncExternalStore`'s server
 * snapshot (always `false`) is used for the first render, so there is no hydration
 * mismatch either — only a brief expanded-then-collapses flash for a returning visitor
 * who had previously collapsed the rail.
 */
let cachedCollapsed: boolean | undefined;
const collapseListeners = new Set<() => void>();

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    // Private browsing / storage blocked — expanded is a perfectly fine default.
    return false;
  }
}

function getCollapsedSnapshot(): boolean {
  if (cachedCollapsed === undefined) cachedCollapsed = readCollapsed();
  return cachedCollapsed;
}

function getCollapsedServerSnapshot(): boolean {
  return false;
}

function subscribeCollapsed(listener: () => void): () => void {
  collapseListeners.add(listener);
  return () => collapseListeners.delete(listener);
}

function setCollapsedPersisted(next: boolean) {
  cachedCollapsed = next;
  try {
    window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
  } catch {
    // Nothing to persist to — the in-memory value above still updates this tab.
  }
  for (const listener of collapseListeners) listener();
}

/**
 * The sidebar app frame. Replaces the old header + horizontal dropdown-bar nav with a
 * persistent sidebar (icon-rail collapsible on desktop, an off-canvas drawer on mobile).
 *
 * `items` is built server-side in `app-shell.tsx` from the viewer's own grants — this
 * component only renders it, never decides what belongs in it.
 */
export default function SidebarShell({
  orgName,
  logoUrl,
  fullName,
  email,
  role,
  items,
  showChatWidget = false,
  children,
}: {
  orgName: string;
  logoUrl: string | null;
  fullName: string;
  email: string;
  role: string;
  items: NavEntry[];
  showChatWidget?: boolean;
  children: React.ReactNode;
}) {
  const collapsed = useSyncExternalStore(
    subscribeCollapsed,
    getCollapsedSnapshot,
    getCollapsedServerSnapshot
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuCloseRef = useRef<HTMLButtonElement>(null);

  function toggleCollapsed() {
    setCollapsedPersisted(!collapsed);
  }

  return (
    <div className="flex min-h-dvh bg-muted/30">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-background transition-[width] duration-200 md:flex",
          collapsed ? "w-16" : "w-64"
        )}
      >
        <div className={cn("flex h-14 shrink-0 items-center gap-2.5 border-b px-4", collapsed && "justify-center px-0")}>
          <Link
            href="/dashboard"
            className="flex min-w-0 items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <OrgLogo url={logoUrl} name={orgName} />
            {!collapsed && (
              <span className="min-w-0 truncate text-sm font-semibold leading-tight">{orgName}</span>
            )}
          </Link>
        </div>

        {!collapsed && (
          <div className="shrink-0 px-2.5 pt-3">
            <CommandPalette />
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-2.5 py-3">
          <NavLinks items={items} collapsed={collapsed} onExpand={() => setCollapsedPersisted(false)} />
        </div>

        {!collapsed ? (
          <div className="shrink-0 border-t p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium leading-tight">{fullName}</p>
                <p className="truncate text-xs leading-tight text-muted-foreground">{email}</p>
              </div>
              <Badge variant="secondary" className="shrink-0">
                {role}
              </Badge>
            </div>
            <div className="mt-2.5 flex items-center justify-between gap-1">
              <div className="flex items-center gap-1">
                <ChangelogMenu />
                <SettingsMenu />
              </div>
              <LogoutButton />
            </div>
          </div>
        ) : (
          // Collapsed rail: Changelog/Settings/Logout need more room than 64px gives them
          // cleanly, so the rail's own footer is just an expand affordance — one click away
          // from every action, not a cramped row of clipped buttons.
          <div className="shrink-0 border-t p-2">
            <button
              type="button"
              onClick={toggleCollapsed}
              title={`${fullName} — ${role}`}
              className="flex w-full items-center justify-center rounded-xl py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex size-7 items-center justify-center rounded-full bg-muted">
                {fullName.charAt(0).toUpperCase()}
              </span>
            </button>
          </div>
        )}

        <div className="shrink-0 border-t p-2">
          <button
            type="button"
            onClick={toggleCollapsed}
            className="flex w-full items-center justify-center gap-2 rounded-xl px-2.5 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={collapsed ? "Sidebar kholen" : "Sidebar sikoden"}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            ) : (
              <>
                <PanelLeftClose className="size-4" aria-hidden="true" />
                <span>Sikoden</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Content column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile-only top bar — the sidebar itself carries org branding on desktop. */}
        <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden">
          <button
            type="button"
            ref={menuTriggerRef}
            onClick={() => setMobileOpen(true)}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Menu kholen"
            aria-haspopup="dialog"
            aria-expanded={mobileOpen}
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
            <OrgLogo url={logoUrl} name={orgName} />
            <span className="truncate text-sm font-semibold">{orgName}</span>
          </Link>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <CommandPalette iconOnly />
            <ChangelogMenu />
            <SettingsMenu />
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>

      {/* Base UI owns modal focus, background inertness and stacked Escape dismissal. */}
      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogContent
          showCloseButton={false}
          initialFocus={menuCloseRef}
          finalFocus={menuTriggerRef}
          className="inset-y-0 top-0 left-0 grid h-dvh max-h-dvh w-72 max-w-[85vw] translate-x-0 translate-y-0 grid-rows-[auto_1fr_auto] gap-0 rounded-none p-0 shadow-lg border-r bg-background data-open:zoom-in-100 data-closed:zoom-out-100 data-open:slide-in-from-left data-closed:slide-out-to-left"
        >
          <DialogTitle className="sr-only">Main navigation</DialogTitle>
          <div className="flex h-14 shrink-0 items-center justify-between gap-2.5 border-b px-4">
            <Link
              href="/dashboard"
              onClick={() => setMobileOpen(false)}
              className="flex min-w-0 items-center gap-2.5"
            >
              <OrgLogo url={logoUrl} name={orgName} />
              <span className="truncate text-sm font-semibold">{orgName}</span>
            </Link>
            <DialogClose
              type="button"
              className="flex size-8 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              ref={menuCloseRef}
              aria-label="Menu band karein"
            >
              <X className="size-4" aria-hidden="true" />
            </DialogClose>
          </div>

          <div className="min-h-0 overflow-y-auto px-2.5 py-3">
            <NavLinks items={items} onNavigate={() => setMobileOpen(false)} />
          </div>

          <div className="shrink-0 border-t p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium leading-tight">{fullName}</p>
                <p className="truncate text-xs leading-tight text-muted-foreground">{email}</p>
              </div>
              <Badge variant="secondary" className="shrink-0">
                {role}
              </Badge>
            </div>
            <div className="mt-2.5 flex items-center justify-end">
              <LogoutButton />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {showChatWidget && <ChatWidget />}
    </div>
  );
}
