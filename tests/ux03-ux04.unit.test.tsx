import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

const state = vi.hoisted(() => ({
  value: {} as unknown,
  collapsed: false,
  updates: [] as unknown[],
}));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: () => [state.value, (next: unknown) => {
      state.value = typeof next === "function" ? next(state.value) : next;
      state.updates.push(state.value);
    }],
    useId: () => "test-nav",
    useRef: () => ({ current: null }),
    useSyncExternalStore: () => state.collapsed,
  };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/tasks" }));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("@/components/preferences-provider", () => ({ useT: () => (text: string) => text }));
vi.mock("@/app/chat/chat-client", () => ({ default: () => null }));
vi.mock("@/components/ui/button", () => ({ Button: "button" }));
vi.mock("@/components/ui/badge", () => ({ Badge: "span" }));
vi.mock("@/components/ui/dialog", () => ({ Dialog: "dialog-root", DialogClose: "dialog-close", DialogContent: "dialog-content", DialogTitle: "dialog-title" }));
vi.mock("@/components/command-palette", () => ({ default: () => null }));
vi.mock("@/app/dashboard/logout-button", () => ({ default: () => null }));
vi.mock("@/components/logo-picker", () => ({ OrgLogo: () => null }));
vi.mock("@/components/settings-menu", () => ({ default: () => null }));
vi.mock("@/components/changelog-menu", () => ({ default: () => null }));

import NavLinks from "@/components/nav-links";
import ChatWidget from "@/components/chat-widget";
import SidebarShell from "@/components/sidebar-shell";

type Props = Record<string, unknown>;
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function named(nodes: ReactElement<Props>[], label: string) {
  const found = nodes.find((node) => node.props["aria-label"] === label);
  if (!found) throw new Error(`Missing ${label}`);
  return found;
}
const items = [{ label: "MDO", icon: "mdo" as const, items: [{ href: "/tasks", label: "Tasks" }] }];
beforeEach(() => { state.value = {}; state.collapsed = false; state.updates = []; });

describe("UX-04 navigation render/activation contracts", () => {
  it("does not announce an invisible active group as expanded in rail mode", () => {
    const nodes = elements(NavLinks({ items, collapsed: true }));
    expect(named(nodes, "MDO").props["aria-expanded"]).toBe(false);
    expect(nodes.some((node) => node.props.href === "/tasks")).toBe(false);
  });
  it("rail activation asks the shell to expand and explicitly opens even an active group", () => {
    const expand = vi.fn();
    const nodes = elements(NavLinks({ items, collapsed: true, onExpand: expand }));
    (named(nodes, "MDO").props.onClick as () => void)();
    expect(expand).toHaveBeenCalledOnce();
    expect(state.value).toEqual({ MDO: true });
    const expanded = elements(NavLinks({ items, collapsed: false }));
    expect(named(expanded, "MDO").props["aria-expanded"]).toBe(true);
    const id = named(expanded, "MDO").props["aria-controls"];
    expect(expanded.some((node) => node.props.id === id)).toBe(true);
    expect(expanded.some((node) => node.props.href === "/tasks")).toBe(true);
  });
  it("expanded activation collapses the visible group", () => {
    const nodes = elements(NavLinks({ items }));
    (named(nodes, "MDO").props.onClick as () => void)();
    expect(state.value).toEqual({ MDO: false });
    expect(named(elements(NavLinks({ items })), "MDO").props["aria-expanded"]).toBe(false);
  });
  it("names icon-only leaf links", () => {
    const nodes = elements(NavLinks({ items: [{ href: "/tasks", label: "Tasks", icon: "tasks" }], collapsed: true }));
    expect(named(nodes, "Tasks").props.href).toBe("/tasks");
  });
});

describe("UX-03 overlay wiring contracts (not DOM focus tests)", () => {
  it("keeps chat nonmodal and closes only its own unhandled Escape", () => {
    state.value = true;
    const panel = named(elements(ChatWidget()), "Pro ERP Chatbot");
    expect(panel.props["aria-modal"]).toBe("false");
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    (panel.props.onKeyDown as (event: unknown) => void)({ key: "Escape", defaultPrevented: false, preventDefault, stopPropagation });
    expect(state.value).toBe(false);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
  });
  it("leaves Escape consumed by a child overlay alone", () => {
    state.value = true;
    const panel = named(elements(ChatWidget()), "Pro ERP Chatbot");
    (panel.props.onKeyDown as (event: unknown) => void)({ key: "Escape", defaultPrevented: true });
    expect(state.updates).toEqual([]);
  });
  it("does not react to unrelated keys", () => {
    state.value = true;
    const panel = named(elements(ChatWidget()), "Pro ERP Chatbot");
    (panel.props.onKeyDown as (event: unknown) => void)({ key: "Enter", defaultPrevented: false });
    expect(state.updates).toEqual([]);
  });
  it("wires the real drawer primitive to explicit focus targets and rail expansion", () => {
    state.value = true;
    const nodes = elements(SidebarShell({ orgName: "Org", logoUrl: null, fullName: "User", email: "user@example.test", role: "Admin", items, children: null }));
    const popup = nodes.find((node) => node.type === "dialog-content")!;
    expect(popup.props.initialFocus).toBeDefined();
    expect(popup.props.finalFocus).toBe(named(nodes, "Menu kholen").props.ref);
    expect(nodes.find((node) => node.type === NavLinks && node.props.onExpand)?.props.onExpand).toBeTypeOf("function");
  });
});
