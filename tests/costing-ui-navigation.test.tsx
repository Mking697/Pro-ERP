import { beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { SessionPayload } from "@/lib/auth/session";
import type { NavEntry } from "@/components/nav-links";
const m = vi.hoisted(() => ({ getTenant: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ getTenant: m.getTenant, runWithTenant: (_tenant: unknown, read: () => unknown) => read() }));
vi.mock("@/lib/i18n/server", () => ({ getT: async () => (value: string) => value }));
vi.mock("@/lib/settings", () => ({ getSetting: async () => null }));
vi.mock("@/lib/fms/templates", () => ({ listNavFmsTemplates: async () => [] }));
vi.mock("@/lib/inventory/plans", () => ({ listUsedFmsTemplateIds: async () => new Set() }));
vi.mock("@/lib/platform/admin", () => ({ isPlatformAdmin: () => false }));
vi.mock("@/components/sidebar-shell", () => ({ default: () => null }));
import AppShell from "@/components/app-shell";
beforeEach(() => { m.getTenant.mockResolvedValue({ orgId: "ORG", org: { orgName: "QA" } }); });
const viewer = { orgId: "ORG", userId: "U", email: "qa@example.invalid", role: "Doer", access: [] } as unknown as SessionPayload;
function flatten(entries: NavEntry[]): Array<{ href: string }> {
  return entries.flatMap(entry => "items" in entry ? flatten(entry.items) : [entry]);
}
it("costing-only users can discover Cost Sheets without BOM/Purchase/Inventory grants", async () => {
  const tree = await AppShell({ session: { ...viewer, access: ["COST_SHEETS"] }, children: null }) as ReactElement<{ items: NavEntry[] }>;
  expect(flatten(tree.props.items)).toContainEqual(expect.objectContaining({ href: "/cost-sheets" }));
});
it("purchase and inventory grants alone do not show the sensitive costing destination", async () => {
  const tree = await AppShell({ session: { ...viewer, access: ["PURCHASE_FMS", "INVENTORY_VIEW"] }, children: null }) as ReactElement<{ items: NavEntry[] }>;
  expect(flatten(tree.props.items).some(entry => entry.href === "/cost-sheets")).toBe(false);
});
