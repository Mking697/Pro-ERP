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

// BEGIN request guard (pure logic, exercised by isolated tests)
class RequestSequencer {
  private currentId = 0;
  private controller: AbortController | null = null;

  begin(): { id: number; signal: AbortSignal } {
    this.controller?.abort();
    this.controller = new AbortController();
    this.currentId += 1;
    return { id: this.currentId, signal: this.controller.signal };
  }

  isStale(id: number): boolean {
    return id !== this.currentId;
  }

  get activeId(): number {
    return this.currentId;
  }
}

// END request guard

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
  const sendFlight = useRef<{ sessionId: string | null; optimisticId: string } | null>(null);
  const optimisticIdCounter = useRef(0);
  const historyBusy = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/chatbot/config").then((r) => r.json()),
      fetch("/api/chatbot/sessions").then((r) => r.json()),
    ])
      .then(([cfg, sess]: [ConfigResponse, { sessions?: SessionSummary[] }]) => {
        setConfig(cfg);
        setSessions(sess.sessions ?? []);
      })
      .catch(() => toast.error(t("Pro ERP Chatbot load nahi ho paya.")))
      .finally(() => setLoadingConfig(false));
  }, [t]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const historySeqRef = useRef(new RequestSequencer());

  useEffect(() => {
    mounted.current = true;
    const seq = historySeqRef.current;
    return () => { mounted.current = false; seq.begin(); };
  }, []);

  // UX-02: block switching/New Chat during a send. The synchronous ref also
  // closes the gap before React renders disabled controls. History may switch,
  // but only the latest open attempt can write, and sending waits for history.
  async function openSession(id: string) {
    if (sendFlight.current) return;
    historyBusy.current = true;
    setMessages([]);
    setActiveSessionId(id);
    setLoadingMessages(true);
    const { id: reqId, signal } = historySeqRef.current.begin();
    try {
      const res = await fetch(`/api/chatbot/sessions/${id}`, { signal });
      if (!res.ok) throw new Error(`History request failed (${res.status})`);
      const data = await res.json();
      if (historySeqRef.current.isStale(reqId)) return; // user already opened a different session
      setMessages((data.messages ?? []).map((m: Message) => ({ ...m })));
    } catch {
      if (historySeqRef.current.isStale(reqId)) return;
      toast.error(t("Chat load nahi ho paya."));
    } finally {
      if (!historySeqRef.current.isStale(reqId)) { historyBusy.current = false; setLoadingMessages(false); }
    }
  }

  function startNewChat() {
    if (sendFlight.current) return;
    historySeqRef.current.begin(); // invalidates any still-in-flight openSession() response too
    historyBusy.current = false;
    setLoadingMessages(false);
    setActiveSessionId(null);
    setMessages([]);
    setDraft("");
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sendFlight.current || historyBusy.current) return;

    // A real optimistic id (not a positional `slice(0,-1)` rollback) — rollback below always
    // removes exactly this message by id, so it can never delete the wrong bubble even if
    // something else appended to `messages` in between (e.g. a session's own history re-render).
    // Deterministic monotonic per-mount id — no impure Date.now()/Math.random() during render
    // (react-hooks/purity), but still unique enough to never collide with a real message id.
    optimisticIdCounter.current += 1;
    const optimisticId = `tmp-${optimisticIdCounter.current}`;
    const flight = { sessionId: activeSessionId, optimisticId };
    sendFlight.current = flight;
    setSending(true);
    setDraft("");
    setMessages((prev) => [
      ...prev,
      { id: optimisticId, role: "user", content: trimmed, toolsUsed: [], createdAt: new Date().toISOString() },
    ]);

    const rollbackOptimisticMessage = () =>
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));

    try {
      const res = await fetch("/api/chatbot/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: flight.sessionId ?? undefined, message: trimmed }),
      });
      const data = await res.json();
      if (!mounted.current || sendFlight.current !== flight) return;

      if (res.status === 429) {
        toast.error(t("Aaj ke liye Pro ERP Chatbot ki message limit poori ho gayi — kal phir try karein."));
        rollbackOptimisticMessage();
        return;
      }

      if (data.status === "not_connected") {
        rollbackOptimisticMessage();
        setConfig((prev) => (prev ? { ...prev, connected: false } : prev));
        return;
      }

      if (!res.ok) {
        toast.error(t(data.error ?? "Message bhej nahi paya."));
        rollbackOptimisticMessage();
        return;
      }

      if (!activeSessionId && data.sessionId) {
        setActiveSessionId(data.sessionId);
        setSessions((prev) => [
          { id: data.sessionId, title: trimmed.slice(0, 80), updatedAt: new Date().toISOString() },
          ...prev,
        ]);
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
      if (!mounted.current || sendFlight.current !== flight) return;
      setDraft(trimmed);
      toast.error(t("Kuch galat ho gaya — dobara try karein."));
      rollbackOptimisticMessage();
    } finally {
      if (sendFlight.current === flight) {
        sendFlight.current = null;
        if (mounted.current) setSending(false);
      }
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
          <p className="text-lg font-medium">{t("Pro ERP Chatbot abhi connect nahi hai")}</p>
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
            <Button
              variant="outline"
              size="sm"
              className="justify-start gap-2"
              onClick={startNewChat}
              disabled={sending}
              title={sending ? t("Message bhejte waqt chat switch nahi ki ja sakti.") : undefined}
            >
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
                  disabled={sending}
                  title={sending ? t("Message bhejte waqt chat switch nahi ki ja sakti.") : undefined}
                  className={cn(
                    "w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50",
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
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={startNewChat}
                disabled={sending}
                title={sending ? t("Message bhejte waqt chat switch nahi ki ja sakti.") : undefined}
              >
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
                      <Button key={q} variant="secondary" size="sm" onClick={() => send(q)} disabled={sending || loadingMessages}>
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
              disabled={sending || loadingMessages}
            />
            <Button type="submit" size="icon" disabled={sending || loadingMessages || !draft.trim()} aria-label={t("Bhejein")}>
              <Send className="size-4" aria-hidden="true" />
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
