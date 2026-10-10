import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode, type ReactElement } from "react";
const h = vi.hoisted(() => ({ state: [] as unknown[], refs: [] as {current: unknown}[], effects: [] as {deps?: unknown[]; cleanup?: () => void}[], cursor: 0, refCursor: 0, effectCursor: 0, fetch: vi.fn() }));
vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return { ...actual,
    useState: (initial: unknown) => { const i = h.cursor++; if (!(i in h.state)) h.state[i] = initial; return [h.state[i], (v: unknown) => { h.state[i] = typeof v === "function" ? v(h.state[i]) : v; }]; },
    useRef: (initial: unknown) => { const i = h.refCursor++; return h.refs[i] ??= { current: initial }; },
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => void | (() => void), deps: unknown[]) => { const i = h.effectCursor++; const prev = h.effects[i]; if (!prev || deps.some((v, j) => v !== prev.deps?.[j])) { prev?.cleanup?.(); h.effects[i] = { deps, cleanup: fn() || undefined }; } },
  };
});
vi.mock("@/components/preferences-provider", () => { const translate = (text: string) => text; return { useT: () => translate }; });
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: "dialog", DialogContent: "div", DialogTitle: "h1" }));
import Palette from "@/components/command-palette";
function nodes(n: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(n)) return n.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(n)) return [];
  return [n, ...nodes(n.props.children as ReactNode)];
}
function render() { h.cursor = h.refCursor = h.effectCursor = 0; return nodes(Palette({})); }
function input(value: string) { const node = render().find(n => n.type === "input")!; (node.props.onChange as (v: unknown) => void)({ target: { value } }); render(); }
function open() { (render().find(n => n.props["aria-label"] === "Global search kholen")!.props.onClick as () => void)(); render(); }
function close() { (render().find(n => n.type === "dialog")!.props.onOpenChange as (v: boolean) => void)(false); render(); }
const result = (id: string) => ({ kind: "item", id, title: id, subtitle: id, href: "/inventory/" + id });
beforeEach(() => { h.state = []; h.refs = []; h.effects = []; vi.useFakeTimers(); vi.resetAllMocks(); vi.stubGlobal("fetch", h.fetch); vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() }); });
afterEach(() => { h.effects.forEach(e => e.cleanup?.()); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("late A cannot replace B, including loading state; old fetch is aborted", async () => {
  let resolveA!: (r: Response) => void; let signal!: AbortSignal;
  h.fetch.mockImplementationOnce((_u, init) => { signal = init?.signal; return new Promise<Response>(r => { resolveA = r; }); });
  h.fetch.mockResolvedValueOnce(Response.json({ results: [result("B")], hasMore: false }));
  open(); input("alpha"); await vi.advanceTimersByTimeAsync(250);
  input("bravo"); await vi.advanceTimersByTimeAsync(250);
  resolveA(Response.json({ results: [result("A")] })); await vi.advanceTimersByTimeAsync(0);
  expect(h.state[2]).toEqual([result("B")]); expect(h.state[3]).toBe(false); expect(signal.aborted).toBe(true);
});
it("closing the palette aborts and prevents a late response reopening results", async () => {
  let resolve!: (r: Response) => void;
  h.fetch.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; }));
  open(); input("alpha"); await vi.advanceTimersByTimeAsync(250); close();
  resolve(Response.json({ results: [result("A")] })); await vi.advanceTimersByTimeAsync(0);
  expect(h.state[2]).toEqual([]); expect(h.state[3]).toBe(false);
});
it("JSON HTTP failures surface errors rather than success-empty results", async () => {
  h.fetch.mockResolvedValue(Response.json({ error: "Forbidden" }, { status: 403 }));
  open(); input("alpha"); await vi.advanceTimersByTimeAsync(250);
  expect(render().some(n => n.props.role === "alert")).toBe(true);
});
it("retry restarts the same failed query without editing it", async () => {
  h.fetch.mockResolvedValueOnce(Response.json({ error: "Forbidden" }, { status: 403 }));
  h.fetch.mockResolvedValueOnce(Response.json({ results: [result("retried")], hasMore: false }));
  open(); input("alpha"); await vi.advanceTimersByTimeAsync(250);
  const retry = render().find(n => n.props["aria-label"] === "Retry search"); expect(retry).toBeDefined();
  (retry!.props.onClick as () => void)(); render(); await vi.advanceTimersByTimeAsync(250);
  expect(h.fetch).toHaveBeenCalledTimes(2); expect(h.state[2]).toEqual([result("retried")]);
});
it("loads the next bounded page only after an explicit next action", async () => {
  h.fetch.mockResolvedValue(Response.json({ results: [result("A")], hasMore: true, page: 0 }));
  open(); input("alpha"); await vi.advanceTimersByTimeAsync(250);
  const next = render().find(n => n.props["aria-label"] === "Next search page"); expect(next).toBeDefined();
  (next!.props.onClick as () => void)(); render(); await vi.advanceTimersByTimeAsync(250);
  expect(h.fetch.mock.calls[1][0]).toContain("page=1");
});
