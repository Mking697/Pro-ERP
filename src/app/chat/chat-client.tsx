"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageSquarePlus, Send, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDueDisplay } from "@/lib/formatDate";
import { useT } from "@/components/preferences-provider";

interface SessionSummary {
  id: string;
  title: string;
  updatedAt: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolsUsed: string[];
  createdAt: string;
}

interface ConfigResponse {
  connected: boolean;
  suggestedQuestions: string[];
}

/**
 * The chat UI: a session list on the left (multi-turn context lives per-session, see
 * src/lib/chatbot/orchestrator.ts's own history replay), a transcript + composer on the
 * right. Every actual access-control decision already happened server-side by the time
 * anything renders here — this component only ever calls its own org's already-guarded
 * /api/chatbot/* routes, never touches Gemini or the database directly.
 *
 * `compact`: used by the floating widget (src/components/chat-widget.tsx), which has far
 * less screen real estate than the dedicated /chat page — hides the session-list sidebar
 * (still fetched, so "New Chat" and reopening today's conversation still work once the
 * widget itself grows a switcher; there just isn't room to show the list today) and drops
 * the outer Card chrome, since the widget's own floating panel already provides that.
 */
export default function ChatClient({ compact = false }: { compact?: boolean }) {
  const t = useT();
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/chatbot/config").then((r) => r.json()),
      fetch("/api/chatbot/sessions").then((r) => r.json()),
    ])
      .then(([cfg, sess]: [ConfigResponse, { sessions?: SessionSummary[] }]) => {
        setConfig(cfg);
        setSessions(sess.sessions ?? []);
      })
      .catch(() => toast.error(t("AI Assistant load nahi ho paya.")))
      .finally(() => setLoadingConfig(false));
  }, [t]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function openSession(id: string) {
    setActiveSessionId(id);
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/chatbot/sessions/${id}`);
      const data = await res.json();
      setMessages(
        (data.messages ?? []).map((m: Message) => ({ ...m }))
      );
    } catch {
      toast.error(t("Chat load nahi ho paya."));
    } finally {
      setLoadingMessages(false);
    }
  }

  function startNewChat() {
    setActiveSessionId(null);
    setMessages([]);
    setDraft("");
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setDraft("");
    // Optimistic user bubble — the real row is created server-side; a temporary id is fine
    // since this is purely a display list, not something looked up by id afterward.
    setMessages((prev) => [
      ...prev,
      { id: `tmp-${Date.now()}`, role: "user", content: trimmed, toolsUsed: [], createdAt: new Date().toISOString() },
    ]);

    try {
      const res = await fetch("/api/chatbot/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: activeSessionId ?? undefined, message: trimmed }),
      });
      const data = await res.json();

      if (!activeSessionId && data.sessionId) {
        setActiveSessionId(data.sessionId);
        setSessions((prev) => [
          { id: data.sessionId, title: trimmed.slice(0, 80), updatedAt: new Date().toISOString() },
          ...prev,
        ]);
      }

      if (res.status === 429) {
        toast.error(t("Aaj ke liye AI Assistant ki message limit poori ho gayi — kal phir try karein."));
        setMessages((prev) => prev.slice(0, -1));
        return;
      }

      if (data.status === "not_connected") {
        setConfig((prev) => (prev ? { ...prev, connected: false } : prev));
        return;
      }

      if (!res.ok) {
        toast.error(t(data.error ?? "Message bhej nahi paya."));
        setMessages((prev) => prev.slice(0, -1));
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `${data.sessionId}-${Date.now()}`,
          role: "assistant",
          content: data.reply,
          toolsUsed: data.toolsCalled ?? [],
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch {
      toast.error(t("Kuch galat ho gaya — dobara try karein."));
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setSending(false);
    }
  }

  if (loadingConfig) {
    return (
      <Card className={cn("flex-1", compact && "border-0 shadow-none")}>
        <CardContent className="space-y-3 p-6">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (config && !config.connected) {
    return (
      <Card className={cn("flex-1", compact && "border-0 shadow-none")}>
        <CardContent className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
          <Sparkles className="size-10 text-muted-foreground" aria-hidden="true" />
          <p className="text-lg font-medium">{t("AI Assistant abhi connect nahi hai")}</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {t(
              "Apne Admin se kahein ke Settings → AI Chatbot me apna Gemini API key daal dein — us ke baad hi ye assistant kaam karega."
            )}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {!compact && (
        <Card className="hidden w-64 shrink-0 sm:flex sm:flex-col">
          <CardContent className="flex h-full flex-col gap-2 p-3">
            <Button variant="outline" size="sm" className="justify-start gap-2" onClick={startNewChat}>
              <MessageSquarePlus className="size-4" aria-hidden="true" />
              {t("New Chat")}
            </Button>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
              {sessions.length === 0 && (
                <p className="px-2 py-4 text-xs text-muted-foreground">{t("Abhi tak koi chat nahi hai.")}</p>
              )}
              {sessions.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => openSession(s.id)}
                  className={cn(
                    "w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                    activeSessionId === s.id && "bg-accent text-accent-foreground"
                  )}
                >
                  {s.title || t("Nayi chat")}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className={cn("flex min-h-0 flex-1 flex-col", compact && "border-0 shadow-none")}>
        <CardContent className={cn("flex min-h-0 flex-1 flex-col gap-3", compact ? "p-1" : "p-4")}>
          {compact && (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={startNewChat}>
                <MessageSquarePlus className="size-3.5" aria-hidden="true" />
                {t("New Chat")}
              </Button>
            </div>
          )}
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {loadingMessages ? (
              <Skeleton className="h-24 w-full" />
            ) : messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <Sparkles className="size-8 text-muted-foreground" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  {t("Apne tasks, MIS score, ya FMS steps ke baare me kuch bhi poochein.")}
                </p>
                {config && config.suggestedQuestions.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-2">
                    {config.suggestedQuestions.map((q) => (
                      <Button key={q} variant="secondary" size="sm" onClick={() => send(q)}>
                        {q}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
                >
                  <div
                    className={cn(
                      "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                      m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"
                    )}
                  >
                    {m.content}
                    {m.role === "assistant" && m.toolsUsed.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {m.toolsUsed.map((tool) => (
                          <Badge key={tool} variant="outline" className="text-[10px]">
                            {tool}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className="mt-1 text-[10px] opacity-60">{formatDueDisplay(m.createdAt)}</div>
                  </div>
                </div>
              ))
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
            className="flex items-end gap-2"
          >
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              placeholder={t("Apna sawal likhein...")}
              className="min-h-11"
              disabled={sending}
            />
            <Button type="submit" size="icon" disabled={sending || !draft.trim()} aria-label={t("Bhejein")}>
              <Send className="size-4" aria-hidden="true" />
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
