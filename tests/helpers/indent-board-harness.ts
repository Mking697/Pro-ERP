import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, vi } from "vitest";

type Element = { type: string; props: { children?: unknown; onClick?: () => Promise<void>; disabled?: boolean } };

// No DOM packages are installed. Execute the actual TSX caller with a small
// hook/element harness, not a replacement implementation of raise().
export function boardHarness(responses: Array<{ status: number; body: unknown } | Error> | ((request: Request) => Promise<Response>)) {
  const row = (sku: string) => ({ sku, itemName: sku, uom: "EA", suggestedQty: 2, vendors: [] });
  const state: unknown[] = [[row("A"), row("B")], 0, { A: true, B: true }, { A: "3", B: "4" }, false, false, 0];
  let cursor = 0;
  const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
  const fetch = vi.fn(async (url: string, options: RequestInit) => {
    if (typeof responses === "function") return responses(new Request(`https://example.invalid${url}`, options));
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (!response) throw new Error("Unexpected fetch");
    return { ok: response.status >= 200 && response.status < 300, status: response.status, json: async () => response.body };
  });
  const jsx = (type: string, props: Element["props"]) => ({ type, props });
  const react = {
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in state)) state[index] = initial;
      return [state[index], (next: unknown) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
    },
    useMemo: (compute: () => unknown) => compute(),
    useEffect: () => {},
  };
  const exports: { default?: () => Element } = {};
  const source = readFileSync("src/app/inventory/reorder/reorder-board.tsx", "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(output, {
    exports, fetch,
    require: (name: string) => {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "Fragment" };
      if (name === "sonner") return { toast };
      if (name.includes("preferences-provider")) return { useT: () => (text: string) => text };
      if (name === "../types") return { qty: String, statusVariant: () => "default" };
      if (name.includes("utils")) return { cn: () => "" };
      return new Proxy({}, { get: (_, key) => String(key) });
    },
  });
  function elements(node: unknown): Element[] {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!node || typeof node !== "object" || !("props" in node)) return [];
    const element = node as Element;
    return [element, ...elements(element.props.children)];
  }
  function render() {
    cursor = 0;
    return elements((exports.default as (props: { canRaise: boolean }) => Element)({ canRaise: true }));
  }
  return {
    state, toast, fetch, render,
    async raise() {
      const button = render().find((element) => element.type === "Button")!;
      expect(button.props.disabled).toBe(false);
      await button.props.onClick!();
    },
    payloadSkus(call: number) {
      const options = (fetch.mock.calls as unknown as Array<[string, { body: string }]>)[call][1];
      return JSON.parse(options.body).indents.map((item: { sku: string }) => item.sku);
    },
  };
}

