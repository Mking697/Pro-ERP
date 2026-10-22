import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

type Element = { type: unknown; props: Record<string, unknown> };
type Kind = "order" | "bill" | "advance" | "cancel";
const order = { id: "ORD-1", status: "Payment_Review", items: [], orderValue: 100, displayCurrency: "INR" };
const response = (status = 200, body: unknown = { order, bill: {} }) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// No DOM renderer is installed. Execute actual TSX + event closures with persistent
// useRef cells and deferred state commits (no rerender between the rapid clicks).
// Only React/UI boundaries and network are substituted; mutation logic is production code.
function harness(kind: Kind, send: (url: string, init: RequestInit) => Promise<unknown>) {
  const isBulk = kind === "advance" || kind === "cancel";
  const state: unknown[] = isBulk
    ? ["Payment_Review", { Payment_Review: [order, { ...order, id: "ORD-2" }] }, [], false, null, 0, null, null, new Set(["ORD-1", "ORD-2"]), false, kind === "advance" ? "payment-review" : "cancel", "", "reason"]
    : kind === "order" ? [order, [], [], false, false]
      : [{ bill: { status: "Issued", amount: 100, gstAmount: 0 }, totalPaid: 0, payments: [] }, false, false, "", "", "100", "0", "25", "Bank_Transfer", "ref"];
  let cursor = 0;
  let refCursor = 0;
  const refs: { current: unknown }[] = [];
  const jsx = (type: unknown, props: Element["props"]) => ({ type, props });
  const react = {
    useState(initial: unknown) { const index = cursor++; if (!(index in state)) state[index] = initial; return [state[index], (next: unknown) => { state[index] = typeof next === "function" ? next(state[index]) : next; }]; },
    useRef(initial: unknown) { const index = refCursor++; return refs[index] ??= { current: initial }; },
    useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn, useEffect() {},
  };
  const fetch = vi.fn((url: string, init: RequestInit = {}) => init.method === "POST" ? send(url, init) : Promise.resolve(response()));
  const cache: Record<string, Record<string, unknown>> = {};
  function load(file: string): Record<string, unknown> {
    if (cache[file]) return cache[file];
    const exports = cache[file] = {};
    const source = process.env.SECURITY_BASELINE === "1" && file !== "src/lib/client-idempotency.ts"
      ? execFileSync("git", ["show", `a34ff83:${file}`], { encoding: "utf8" }) : readFileSync(file, "utf8");
    const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    runInNewContext(output, { exports, fetch, crypto: webcrypto, Date, Set, Map, AbortController, console,
      require(name: string) {
        if (name === "react") return react;
        if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
        if (name === "sonner") return { toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } };
        if (name.includes("preferences-provider")) return { useT: () => (s: string) => s };
        if (name === "@/lib/client-idempotency") return load("src/lib/client-idempotency.ts");
        if (name === "./types") return { ORDER_STATUS_LABEL: {} };
        return new Proxy({}, { get: (_, key) => String(key) });
      },
    });
    return exports;
  }
  const file = isBulk ? "src/app/orders/orders-board.tsx" : kind === "order" ? "src/app/orders/order-detail-dialog.tsx" : "src/app/accounts/bill-detail-dialog.tsx";
  const Component = load(file).default as (props: Record<string, unknown>) => unknown;
  function elements(node: unknown): Element[] {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!node || typeof node !== "object" || !("props" in node) || !node.props) return [];
    const element = node as Element;
    return [element, ...elements(element.props.children)];
  }
  function render() { cursor = 0; refCursor = 0; return elements(Component({ orderId: "ORD-1", billId: "BILL-1", open: true, onOpenChange() {}, onChanged() {} })); }
  function action() {
    const tree = render();
    if (kind === "order") {
      const section = tree.find((el) => typeof el.type === "function" && el.type.name === "PaymentSection")!;
      return () => (section.props.onAction as (url: string, body: unknown) => Promise<unknown>)("/api/orders/ORD-1/payment", { amount: 25, mode: "Bank_Transfer", reference: state[10] ?? "ref" });
    }
    const text = kind === "bill" ? "Payment Record Karein" : kind === "cancel" ? "Sab Cancel Karein" : "Apply Karein";
    const button = tree.find((el) => el.type === "Button" && el.props.children === text)!;
    expect(button, text).toBeDefined();
    return button.props.onClick as () => Promise<unknown>;
  }
  return { action, state, posts: () => fetch.mock.calls.filter(([, init]) => init?.method === "POST") };
}
const key = (call: [string, RequestInit?]) => new Headers(call[1]?.headers).get("Idempotency-Key");

describe("actual client mutation handlers", () => {
  it.each<Kind>(["order", "bill", "advance", "cancel"])("%s retains per-row keys after a lost response", async (kind) => {
    let lost = true;
    const ui = harness(kind, async () => { if (lost) throw new Error("response lost after commit"); return response(); });
    await ui.action()();
    const first = ui.posts().map(key);
    expect(first.every(Boolean)).toBe(true);
    lost = false;
    await ui.action()();
    expect(ui.posts().slice(first.length).map(key)).toEqual(first);
  });
  it("a changed payment payload gets a new identity; a confirmed success allows an intentional equal installment", async () => {
    let lost = true;
    const ui = harness("order", async () => { if (lost) throw new Error("lost"); return response(); });
    await ui.action()();
    ui.state[10] = "different-reference";
    lost = false;
    await ui.action()();
    await ui.action()();
    const keys = ui.posts().map(key);
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(3);
  });
  it.each<Kind>(["order", "bill", "advance", "cancel"])("%s suppresses two same-tick identical actions before state rerenders", async (kind) => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => { release = resolve; });
    const ui = harness(kind, () => pending);
    const click = ui.action();
    const first = click();
    const duplicate = click();
    expect(ui.posts()).toHaveLength(1);
    release(response());
    await Promise.all([first, duplicate]);
    expect(ui.posts()).toHaveLength(kind === "advance" || kind === "cancel" ? 2 : 1);
    const keys = ui.posts().map(key);
    expect(keys.every((k) => typeof k === "string" && k.length > 0)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length); // each bulk row has its own key
  });
});
