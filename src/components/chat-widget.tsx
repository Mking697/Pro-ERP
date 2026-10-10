"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Bot, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import ChatClient from "@/app/chat/chat-client";
import { useT } from "@/components/preferences-provider";

/**
 * The floating "Pro ERP Chatbot" launcher — a small round button fixed to the corner of every
 * page (for a user with the `AI_CHATBOT` grant), so asking a question doesn't need
 * navigating away from whatever the user is already doing. Opens the same `ChatClient` the
 * dedicated `/chat` page uses (in its `compact` mode — see that component's own doc comment)
 * inside a floating panel, rather than a second, separate chat implementation.
 */
export default function ChatWidget() {
  const t = useT();
  const [open, setOpen] = useState(false);

  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  function closePanel() {
    setOpen(false);
    launcherRef.current?.focus();
  }

  // Only Escape originating in this panel/launcher belongs to chat. A child that
  // consumed it (e.g. a menu) wins; stop bubbling so the same key cannot dismiss
  // another overlay. No window listener: background Escape leaves chat open.
  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    closePanel();
  }

  return (
    <>
      <button
        type="button"
        ref={launcherRef}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={open ? onKeyDown : undefined}
        aria-controls={open ? panelId : undefined}
        aria-label={open ? t("Pro ERP Chatbot band karein") : t("Pro ERP Chatbot kholein")}
        aria-expanded={open}
        className="fixed right-5 bottom-5 z-50 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {open ? <X className="size-6" aria-hidden="true" /> : <Bot className="size-6" aria-hidden="true" />}
      </button>

      {open && (
        <div
          id={panelId}
          onKeyDown={onKeyDown}
          role="dialog"
          aria-modal="false"
          aria-label={t("Pro ERP Chatbot")}
          className="fixed right-5 bottom-24 z-50 flex h-[min(600px,calc(100vh-8rem))] w-[380px] max-w-[calc(100vw-2.5rem)] animate-in flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl fade-in-0 slide-in-from-bottom-2 duration-200"
        >
          <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              <Bot className="size-4 text-primary" aria-hidden="true" />
              <span className="text-sm font-semibold">{t("Pro ERP Chatbot")}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("Band karein")}
              onClick={closePanel}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col p-2">
            <ChatClient compact />
          </div>
        </div>
      )}
    </>
  );
}
